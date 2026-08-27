import {
  CAPTURE_CHUNK_MS,
  DEFAULT_LIVE_MODEL,
  INPUT_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  languagesForDirection,
} from './config'
import { sessionError, toSessionError } from './errors'
import { connectLiveTransport, type LiveTransport } from './liveTransport'
import {
  INITIAL_SESSION_STATE,
  canStart,
  isSessionActive,
  nextSessionState,
  type SessionEvent,
} from './sessionMachine'
import {
  commitFragment,
  finalizeOpenTurns,
  normalizeTranscription,
} from './transcript'
import {
  createLiveTokenProvider,
  type LiveTokenProvider,
} from './tokenProvider'
import { encodeCaptureChunk } from './audio/pcm'
import {
  startMicrophoneCapture,
  type MicrophoneCapture,
} from './audio/microphoneCapture'
import {
  createPlaybackScheduler,
  type PlaybackScheduler,
} from './audio/playbackScheduler'
import type {
  InterimTranscript,
  SessionError,
  SessionState,
  TranscriptKind,
  TranscriptTurn,
  TranslationDirection,
  TranslationSessionSnapshot,
} from './types'

export interface TranslationSessionOptions {
  /** Defaults to Urdu → English. */
  direction?: TranslationDirection
  /** Overrides the ephemeral-token source. Defaults to the Lingua server. */
  tokenProvider?: LiveTokenProvider
  /** Overrides the model. Otherwise the server's model, then the documented default. */
  model?: string
}

export type SessionListener = (snapshot: TranslationSessionSnapshot) => void

/**
 * Owns one live translation session: lifecycle, state transitions, resource
 * cleanup, and transcript accumulation.
 *
 * Every asynchronous step captures the generation counter it started under. A
 * stop, a failure, or a fresh start bumps that counter, so work belonging to a
 * superseded attempt cleans up after itself instead of mutating current state.
 * That is what keeps a double-click from opening two microphones or two Live
 * sessions.
 */
export class TranslationSession {
  private state: SessionState = INITIAL_SESSION_STATE
  private error: SessionError | null = null
  private transcript: TranscriptTurn[] = []
  private interimTranscript: InterimTranscript | null = null
  private direction: TranslationDirection
  private readonly tokenProvider: LiveTokenProvider
  private readonly modelOverride?: string

  private capture: MicrophoneCapture | null = null
  private playback: PlaybackScheduler | null = null
  private transport: LiveTransport | null = null
  private abortController: AbortController | null = null
  private teardownPromise: Promise<void> | null = null

  private generation = 0
  private turnCounter = 0
  private disposed = false
  private readonly listeners = new Set<SessionListener>()
  private snapshot: TranslationSessionSnapshot

  constructor(options: TranslationSessionOptions = {}) {
    this.direction = options.direction ?? 'ur-to-en'
    this.tokenProvider = options.tokenProvider ?? createLiveTokenProvider()
    this.modelOverride = options.model
    this.snapshot = {
      state: this.state,
      direction: this.direction,
      error: this.error,
      transcript: this.transcript,
      interimTranscript: this.interimTranscript,
    }
  }

  /**
   * Current snapshot. The reference only changes when something changed, so it
   * can be used directly with `useSyncExternalStore`.
   */
  getSnapshot(): TranslationSessionSnapshot {
    return this.snapshot
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Start a session. Ignored while one is already connecting or running, so
   * repeated clicks cannot open a second microphone or Live connection.
   */
  async start(direction?: TranslationDirection): Promise<void> {
    // A rapid Stop -> Start (or direction switch) must finish releasing the
    // previous microphone and playback graph before opening replacements.
    if (this.teardownPromise) {
      await this.teardownPromise
    }

    if (this.disposed || !canStart(this.state)) {
      return
    }

    if (direction) {
      this.direction = direction
    }

    this.error = null
    this.interimTranscript = null
    this.applyEvent('START')
    this.emit()

    const generation = (this.generation += 1)
    const abortController = new AbortController()
    this.abortController = abortController

    try {
      // Create/resume playback while start() is still running from the click.
      // Deferring this until after microphone permission, token fetch, and the
      // Live handshake can lose browser user activation and leave it suspended.
      const playback = await createPlaybackScheduler({
        sampleRate: OUTPUT_SAMPLE_RATE,
        onPlaybackStart: () => this.onPlaybackChange(generation, 'OUTPUT_START'),
        onPlaybackDrained: () => this.onPlaybackChange(generation, 'OUTPUT_END'),
      })
      if (this.isSuperseded(generation)) {
        await playback.dispose()
        return
      }
      this.playback = playback

      // Capture still precedes token minting and the Live connection, so a
      // denied permission fails before either network resource is opened.
      const capture = await startMicrophoneCapture({
        targetSampleRate: INPUT_SAMPLE_RATE,
        chunkMs: CAPTURE_CHUNK_MS,
        onChunk: (samples, sampleRate) => {
          // Chunks captured before the transport is ready are dropped rather
          // than buffered; the UI is still showing "connecting" at that point.
          if (this.isSuperseded(generation) || !this.transport) {
            return
          }
          this.transport.sendAudioChunk(
            encodeCaptureChunk(samples, sampleRate, INPUT_SAMPLE_RATE),
          )
        },
      })
      if (this.isSuperseded(generation)) {
        await capture.stop()
        return
      }
      this.capture = capture

      const token = await this.tokenProvider({
        signal: abortController.signal,
        direction: this.direction,
      })
      if (this.isSuperseded(generation)) {
        return
      }

      const transport = await connectLiveTransport({
        token: token.token,
        model: this.modelOverride ?? token.model ?? DEFAULT_LIVE_MODEL,
        direction: this.direction,
        events: {
          onAudio: (pcm16) => {
            if (!this.isSuperseded(generation)) {
              this.playback?.enqueue(pcm16)
            }
          },
          onTranscript: (kind, transcription) => {
            if (!this.isSuperseded(generation)) {
              this.recordTranscription(kind, transcription)
            }
          },
          onInterimTranscript: (transcription) => {
            if (!this.isSuperseded(generation)) {
              this.recordInterim(transcription)
            }
          },
          onInterrupted: () => {
            if (!this.isSuperseded(generation)) {
              this.playback?.flush()
            }
          },
          onTurnComplete: () => {
            if (!this.isSuperseded(generation)) {
              this.transcript = finalizeOpenTurns(this.transcript)
              this.interimTranscript = null
              this.emit()
            }
          },
          onError: () => {
            void this.fail(sessionError('live-connection-failed'), generation)
          },
          onClosed: (expected) => {
            if (!expected) {
              void this.fail(sessionError('live-disconnected'), generation)
            }
          },
        },
      })
      if (this.isSuperseded(generation)) {
        transport.close()
        return
      }
      this.transport = transport

      this.applyEvent('CONNECTED')
      this.emit()
    } catch (cause) {
      // The only thing that aborts our controller is teardown, which always
      // bumps the generation first, so a supersession check covers cancellation
      // without having to recognise AbortError by shape.
      if (this.isSuperseded(generation)) {
        return
      }
      await this.fail(cause, generation)
    }
  }

  /** Stop the session and release every resource. Safe to call repeatedly. */
  async stop(): Promise<void> {
    this.generation += 1
    this.applyEvent('STOP')
    await this.teardown()
    this.transcript = finalizeOpenTurns(this.transcript)
    this.interimTranscript = null
    this.emit()
  }

  /**
   * Select a translation direction, stopping the current session first.
   * Starting remains an explicit user action so changing the selector never
   * opens the microphone unexpectedly.
   */
  async setDirection(direction: TranslationDirection): Promise<void> {
    if (this.disposed || direction === this.direction) {
      return
    }

    // Store the latest request immediately. Concurrent selector changes then
    // converge on the user's last choice while all callers share teardown.
    this.direction = direction
    if (isSessionActive(this.state)) {
      await this.stop()
      return
    }

    this.emit()
  }

  /** Stop and drop all subscribers. Call from a component unmount. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }
    await this.stop()
    this.disposed = true
    this.listeners.clear()
  }

  /** Clear the in-memory transcript. Nothing is persisted anywhere. */
  clearTranscript(): void {
    this.transcript = []
    this.interimTranscript = null
    this.emit()
  }

  private isSuperseded(generation: number): boolean {
    return generation !== this.generation
  }

  private applyEvent(event: SessionEvent): boolean {
    const next = nextSessionState(this.state, event)
    if (next === null || next === this.state) {
      return false
    }
    this.state = next
    return true
  }

  private onPlaybackChange(generation: number, event: SessionEvent): void {
    if (this.isSuperseded(generation)) {
      return
    }
    if (this.applyEvent(event)) {
      this.emit()
    }
  }

  private recordTranscription(
    kind: TranscriptKind,
    transcription: { text?: string; finished?: boolean; languageCode?: string },
  ): void {
    const languages = languagesForDirection(this.direction)
    const fragment = normalizeTranscription(
      kind,
      transcription,
      kind === 'source' ? languages.source : languages.target,
    )
    if (!fragment) {
      return
    }

    this.turnCounter += 1
    this.transcript = commitFragment(
      this.transcript,
      fragment,
      `turn-${this.turnCounter}`,
      Date.now(),
    )
    if (kind === 'source') {
      // The finalised segment supersedes whatever preview was on screen.
      this.interimTranscript = null
    }
    this.emit()
  }

  private recordInterim(transcription: { text?: string; languageCode?: string }): void {
    const text = transcription.text ?? ''
    if (text.trim().length === 0) {
      return
    }
    this.interimTranscript = {
      text,
      languageCode:
        transcription.languageCode ?? languagesForDirection(this.direction).source,
    }
    this.emit()
  }

  /**
   * Move to the error state and release resources, leaving the session ready to
   * be started again without a page reload.
   */
  private async fail(cause: unknown, generation: number): Promise<void> {
    if (this.isSuperseded(generation)) {
      return
    }

    this.generation += 1
    this.error = toSessionError(cause)
    this.applyEvent('FAIL')
    await this.teardown()
    this.transcript = finalizeOpenTurns(this.transcript)
    this.interimTranscript = null
    this.emit()
  }

  /** The single cleanup path. Every field it touches ends up null. */
  private async teardown(): Promise<void> {
    if (this.teardownPromise) {
      await this.teardownPromise
      return
    }

    const { abortController, transport, capture, playback } = this
    this.abortController = null
    this.transport = null
    this.capture = null
    this.playback = null

    const teardownPromise = (async () => {
      abortController?.abort()
      transport?.close()
      await capture?.stop()
      await playback?.dispose()
    })()
    this.teardownPromise = teardownPromise

    try {
      await teardownPromise
    } finally {
      if (this.teardownPromise === teardownPromise) {
        this.teardownPromise = null
      }
    }
  }

  private emit(): void {
    this.snapshot = {
      state: this.state,
      direction: this.direction,
      error: this.error,
      transcript: this.transcript,
      interimTranscript: this.interimTranscript,
    }
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }
}
