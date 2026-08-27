import {
  CAPTURE_CHUNK_MS,
  DEFAULT_LIVE_MODEL,
  INPUT_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  languagesForDirection,
} from './config'
import { sessionError } from './errors'
import { connectLiveTransport, type LiveTransport } from './liveTransport'
import {
  INITIAL_SESSION_STATE,
  canStart,
  nextSessionState,
  type SessionEvent,
} from './sessionMachine'
import {
  appendFragment,
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
  SessionError,
  SessionState,
  TranscriptKind,
  TranscriptTurn,
  TranslationDirection,
  TranslationSessionSnapshot,
} from './types'

export interface TranslationSessionOptions {
  /** Defaults to Urdu → English, the direction Issue #2 delivers. */
  direction?: TranslationDirection
  /** Overrides the ephemeral-token source. Defaults to the Lingua server. */
  tokenProvider?: LiveTokenProvider
  /** Overrides the model. Otherwise the server's model, then the documented default. */
  model?: string
}

export type SessionListener = (snapshot: TranslationSessionSnapshot) => void

function isSessionError(value: unknown): value is SessionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value
  )
}

function isAbort(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}

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
  private direction: TranslationDirection
  private readonly tokenProvider: LiveTokenProvider
  private readonly modelOverride?: string

  private capture: MicrophoneCapture | null = null
  private playback: PlaybackScheduler | null = null
  private transport: LiveTransport | null = null
  private abortController: AbortController | null = null

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
    if (this.disposed || !canStart(this.state)) {
      return
    }

    if (direction) {
      this.direction = direction
    }

    this.error = null
    this.applyEvent('START')
    this.emit()

    const generation = (this.generation += 1)
    const abortController = new AbortController()
    this.abortController = abortController

    try {
      // Microphone first: an unsupported browser or a denied prompt then fails
      // before a token is minted or a Live session is opened.
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

      const token = await this.tokenProvider(abortController.signal)
      if (this.isSuperseded(generation)) {
        return
      }

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
          onInterrupted: () => {
            if (!this.isSuperseded(generation)) {
              this.playback?.flush()
            }
          },
          onTurnComplete: () => {
            if (!this.isSuperseded(generation)) {
              this.transcript = finalizeOpenTurns(this.transcript)
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
      if (isAbort(cause) || this.isSuperseded(generation)) {
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
    this.transcript = appendFragment(
      this.transcript,
      fragment,
      `turn-${this.turnCounter}`,
      Date.now(),
    )
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
    this.error = isSessionError(cause) ? cause : sessionError('unknown')
    this.applyEvent('FAIL')
    await this.teardown()
    this.transcript = finalizeOpenTurns(this.transcript)
    this.emit()
  }

  /** The single cleanup path. Every field it touches ends up null. */
  private async teardown(): Promise<void> {
    const { abortController, transport, capture, playback } = this
    this.abortController = null
    this.transport = null
    this.capture = null
    this.playback = null

    abortController?.abort()
    transport?.close()
    await capture?.stop()
    await playback?.dispose()
  }

  private emit(): void {
    this.snapshot = {
      state: this.state,
      direction: this.direction,
      error: this.error,
      transcript: this.transcript,
    }
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }
}
