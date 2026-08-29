import {
  BARGE_IN_ENABLED,
  BARGE_IN_ABSOLUTE_FLOOR,
  BARGE_IN_LEVEL_RATIO,
  BARGE_IN_PREBUFFER_CHUNKS,
  BARGE_IN_SETTLE_CHUNKS,
  BARGE_IN_TRIGGER_CHUNKS,
  CAPTURE_CHUNK_MS,
  DEFAULT_LIVE_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  INPUT_SAMPLE_RATE,
  MUTE_WHILE_TRANSLATING,
  OUTPUT_SAMPLE_RATE,
  PLAYBACK_ECHO_GUARD_MS,
} from './config'
import { sessionError, toSessionError } from './errors'
import {
  connectLiveTransport,
  type LiveTransport,
  type LiveTransportEvents,
} from './liveTransport'
import {
  canStart,
  deriveSessionState,
  isSessionActive,
} from './sessionMachine'
import { ConversationCoordinator } from './conversation'
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
import { createEchoGate, type EchoGate } from './audio/echoGate'
import { liveTrace } from './debug'
import { AUTO_SOURCE_LANGUAGE, languageCodesMatch } from '../../types'
import type {
  SessionError,
  SessionLifecycle,
  SourceLanguageCode,
  SupportedLanguageCode,
  TranslationSessionSnapshot,
} from './types'

/** One open Live socket. */
interface Route {
  readonly id: number
  readonly target: SupportedLanguageCode
  transport: LiveTransport | null
}

export interface TranslationSessionOptions {
  /** Defaults to automatic detection of the other language. */
  sourceLanguage?: SourceLanguageCode
  /** Defaults to English. */
  targetLanguage?: SupportedLanguageCode
  /** Overrides the ephemeral-token source. Defaults to the Lingua server. */
  tokenProvider?: LiveTokenProvider
  /** Overrides the model. Otherwise the server's model, then the documented default. */
  model?: string
}

export type SessionListener = (snapshot: TranslationSessionSnapshot) => void

/**
 * Owns the resources a two-way interpreter session needs, and nothing else.
 *
 * A Live Translate session has one `targetLanguageCode` and no source field, so
 * a single socket can only ever translate *into* one language. A conversation
 * between an A speaker and a B speaker therefore needs two of them — one
 * rendering everything into B, one into A — both listening to the same
 * microphone for the whole session. Neither is ever restarted between turns.
 *
 * Which of them is heard, what the conversation currently consists of, and when
 * one person's turn is over are not decided here. They are decided once, in
 * `ConversationCoordinator`, from the evidence every route produces. This class
 * opens sockets, moves microphone audio to them, hands their events to the
 * coordinator, and does what the coordinator asks with the speakers.
 */
export class TranslationSession {
  private lifecycle: SessionLifecycle = 'stopped'
  private error: SessionError | null = null
  private sourceLanguage: SourceLanguageCode
  private targetLanguage: SupportedLanguageCode
  private readonly tokenProvider: LiveTokenProvider
  private readonly modelOverride?: string

  private capture: MicrophoneCapture | null = null
  private playback: PlaybackScheduler | null = null
  private routes: Route[] = []
  private readonly conversation: ConversationCoordinator

  private abortController: AbortController | null = null
  private counterpartAbortController: AbortController | null = null
  private startupPromise: Promise<void> | null = null
  private counterpartStartupPromise: Promise<void> | null = null
  private counterpartRouteId: number | null = null
  private counterpartRequest = 0
  private shutdownPromise: Promise<void> | null = null
  private resourceTeardownPromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null

  private generation = 0
  private routeCounter = 0
  private disposed = false
  /** True while translated speech is physically audible. */
  private speakersBusy = false
  /** Wall clock after which the room may be sent to the API again. */
  private captureResumeAt = 0
  private silentChunk: Float32Array | null = null
  private readonly echoGate: EchoGate = createEchoGate({
    triggerChunks: BARGE_IN_TRIGGER_CHUNKS,
    ratio: BARGE_IN_LEVEL_RATIO,
    absoluteFloor: BARGE_IN_ABSOLUTE_FLOOR,
    settleChunks: BARGE_IN_SETTLE_CHUNKS,
    prebufferChunks: BARGE_IN_PREBUFFER_CHUNKS,
  })
  private readonly listeners = new Set<SessionListener>()
  private snapshot: TranslationSessionSnapshot

  constructor(options: TranslationSessionOptions = {}) {
    this.sourceLanguage = options.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE
    this.targetLanguage = options.targetLanguage ?? DEFAULT_TARGET_LANGUAGE
    this.tokenProvider = options.tokenProvider ?? createLiveTokenProvider()
    this.modelOverride = options.model
    this.conversation = new ConversationCoordinator(
      {
        playAudio: (pcm16) => this.playAudio(pcm16),
        endAudio: () => this.endAudio(),
        flushAudio: () => this.flushAudio(),
        changed: () => this.emit(),
        counterpartDetected: (language) => this.openCounterpartRoute(language),
      },
      {
        targetLanguage: this.targetLanguage,
        counterpart: this.explicitCounterpart(),
        autoDetect: this.sourceLanguage === AUTO_SOURCE_LANGUAGE,
      },
    )
    this.snapshot = this.createSnapshot()
  }

  getSnapshot(): TranslationSessionSnapshot {
    return this.snapshot
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async start(
    sourceLanguage: SourceLanguageCode = this.sourceLanguage,
    targetLanguage: SupportedLanguageCode = this.targetLanguage,
  ): Promise<void> {
    const requestGeneration = this.generation
    const cleanupPromise = this.shutdownPromise ?? this.resourceTeardownPromise
    if (cleanupPromise) await cleanupPromise

    if (
      this.disposed ||
      requestGeneration !== this.generation ||
      !canStart(this.lifecycle)
    ) {
      return
    }

    if (
      sourceLanguage !== AUTO_SOURCE_LANGUAGE &&
      languageCodesMatch(sourceLanguage, targetLanguage)
    ) {
      this.error = sessionError('unknown')
      this.lifecycle = 'error'
      this.emit()
      return
    }

    this.sourceLanguage = sourceLanguage
    this.targetLanguage = targetLanguage
    // An explicit selection *is* the conversation pair. Auto mode learns it from
    // the first person who is not already speaking the language it renders into.
    this.conversation.configure({
      targetLanguage,
      counterpart: this.explicitCounterpart(),
      autoDetect: sourceLanguage === AUTO_SOURCE_LANGUAGE,
    })
    this.error = null
    this.lifecycle = 'connecting'
    this.emit()

    const generation = (this.generation += 1)
    const abortController = new AbortController()
    this.abortController = abortController
    const startupPromise = this.startAttempt(generation, abortController)
    this.startupPromise = startupPromise

    try {
      await startupPromise
    } finally {
      if (this.startupPromise === startupPromise) this.startupPromise = null
    }
  }

  async stop(): Promise<void> {
    this.generation += 1
    this.lifecycle = 'stopped'
    await this.shutdown()
    this.emit()
  }

  /** Select both sides atomically; changing either side stops active resources. */
  async setLanguages(
    sourceLanguage: SourceLanguageCode,
    targetLanguage: SupportedLanguageCode,
  ): Promise<void> {
    if (
      this.disposed ||
      (sourceLanguage === this.sourceLanguage &&
        targetLanguage === this.targetLanguage)
    ) {
      return
    }

    this.sourceLanguage = sourceLanguage
    this.targetLanguage = targetLanguage
    if (
      isSessionActive(this.state) ||
      this.shutdownPromise ||
      this.resourceTeardownPromise
    ) {
      await this.stop()
      return
    }
    this.conversation.configure({
      targetLanguage,
      counterpart: this.explicitCounterpart(),
      autoDetect: sourceLanguage === AUTO_SOURCE_LANGUAGE,
    })
    this.emit()
  }

  async setSourceLanguage(sourceLanguage: SourceLanguageCode): Promise<void> {
    await this.setLanguages(sourceLanguage, this.targetLanguage)
  }

  async setTargetLanguage(targetLanguage: SupportedLanguageCode): Promise<void> {
    await this.setLanguages(this.sourceLanguage, targetLanguage)
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    if (this.disposed) return
    this.disposed = true
    const disposePromise = (async () => {
      try {
        await this.stop()
      } finally {
        this.listeners.clear()
      }
    })()
    this.disposePromise = disposePromise
    await disposePromise
  }

  clearTranscript(): void {
    this.conversation.clearHistory()
  }

  private get state() {
    const phase = this.conversation.phase
    // Auto mode cannot hear the first reply safely until its newly learned
    // return route exists. Keep the session out of Listening for that bounded
    // handshake rather than accepting the start of an utterance only one route
    // can answer.
    if (
      this.lifecycle === 'active' &&
      phase === 'listening' &&
      this.counterpartStartupPromise
    ) {
      return 'translating'
    }
    return deriveSessionState(this.lifecycle, phase)
  }

  private explicitCounterpart(): SupportedLanguageCode | null {
    return this.sourceLanguage === AUTO_SOURCE_LANGUAGE
      ? null
      : this.sourceLanguage
  }

  // --- Startup --------------------------------------------------------------

  private async startAttempt(
    generation: number,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const playback = await createPlaybackScheduler({
        sampleRate: OUTPUT_SAMPLE_RATE,
        onPlaybackStart: () => this.onPlaybackStart(generation),
        onPlaybackEnd: () => this.onPlaybackEnd(generation),
      })
      if (this.isSuperseded(generation)) {
        await playback.dispose()
        return
      }
      this.playback = playback

      const capture = await startMicrophoneCapture({
        targetSampleRate: INPUT_SAMPLE_RATE,
        chunkMs: CAPTURE_CHUNK_MS,
        onChunk: (samples, sampleRate) => this.sendCapture(generation, samples, sampleRate),
      })
      if (this.isSuperseded(generation)) {
        await capture.stop()
        return
      }
      this.capture = capture

      const counterpart = this.explicitCounterpart()
      // Open sequentially. Simultaneous Live handshakes proved unreliable in
      // real browsers even though independent token requests are supported.
      const primary = await this.openRoute({
        generation,
        signal: abortController.signal,
        target: this.targetLanguage,
        expects: counterpart ?? AUTO_SOURCE_LANGUAGE,
      })
      if (this.isSuperseded(generation)) {
        primary.transport?.close()
        return
      }
      this.addRoute(primary)

      // The return direction opens with the session, not on demand: the reply
      // must be interpreted the moment it is spoken, and a socket opened at
      // that point would miss the first seconds of it.
      if (counterpart) {
        const back = await this.openRoute({
          generation,
          signal: abortController.signal,
          target: counterpart,
          expects: this.targetLanguage,
        })
        if (this.isSuperseded(generation)) {
          back.transport?.close()
          return
        }
        this.addRoute(back)
        this.counterpartRouteId = back.id
      }

      this.lifecycle = 'active'
      this.emit()
    } catch (cause) {
      if (!this.isSuperseded(generation)) await this.fail(cause, generation)
    }
  }

  private addRoute(route: Route): void {
    this.routes = [...this.routes, route]
    this.conversation.addRoute(route.id, route.target)
  }

  private async openRoute({
    generation,
    signal,
    target,
    expects,
  }: {
    generation: number
    signal: AbortSignal
    target: SupportedLanguageCode
    /**
     * The other side of the pair, which the server names when it builds this
     * route's system instruction. It is not a constraint the API can enforce:
     * `translationConfig` has no source-language field.
     */
    expects: SourceLanguageCode
  }): Promise<Route> {
    const token = await this.tokenProvider({
      signal,
      sourceLanguage: expects,
      targetLanguage: target,
    })
    if (this.isSuperseded(generation)) {
      throw sessionError('live-connection-failed')
    }

    const route: Route = {
      id: (this.routeCounter += 1),
      target,
      transport: null,
    }
    route.transport = await connectLiveTransport({
      token: token.token,
      model: this.modelOverride ?? token.model ?? DEFAULT_LIVE_MODEL,
      targetLanguage: target,
      systemInstruction: token.systemInstruction,
      signal,
      events: this.routeEvents(generation, route),
    })
    return route
  }

  /**
   * Auto mode has learned or revised the other language of the conversation.
   *
   * This route is an addition to a session that is already interpreting. When
   * evidence changes, the stale return route is removed before its replacement
   * opens. A failure degrades rather than ending the session: the next target-
   * language utterance simply has no return direction to be spoken through.
   */
  private openCounterpartRoute(language: SupportedLanguageCode): void {
    const generation = this.generation
    if (this.isSuperseded(generation)) return

    const current = this.routes.find(
      (route) => route.id === this.counterpartRouteId,
    )
    if (current && languageCodesMatch(current.target, language)) return

    const request = (this.counterpartRequest += 1)
    this.counterpartAbortController?.abort()
    this.counterpartAbortController = null
    if (current) {
      current.transport?.close()
      this.routes = this.routes.filter((route) => route.id !== current.id)
      this.conversation.removeRoute(current.id)
    }
    this.counterpartRouteId = null

    const abortController = new AbortController()
    this.counterpartAbortController = abortController
    const startupPromise = (async () => {
      try {
        const route = await this.openRoute({
          generation,
          signal: abortController.signal,
          target: language,
          expects: this.targetLanguage,
        })
        if (
          this.isSuperseded(generation) ||
          request !== this.counterpartRequest
        ) {
          route.transport?.close()
          return
        }
        this.addRoute(route)
        this.counterpartRouteId = route.id
        this.emit()
      } catch {
        // Nothing to undo: the pair the coordinator settled on is still right,
        // it just has no socket answering it yet.
      }
    })()
    this.counterpartStartupPromise = startupPromise
    void startupPromise.finally(() => {
      if (
        this.counterpartStartupPromise === startupPromise &&
        request === this.counterpartRequest
      ) {
        this.counterpartStartupPromise = null
        this.counterpartAbortController = null
        if (!this.isSuperseded(generation)) this.emit()
      }
    })
  }

  private routeEvents(generation: number, route: Route): LiveTransportEvents {
    const conversation = this.conversation
    // Route id and target, never text or tokens: a trace is meant to be
    // pasteable into an issue.
    const trace = (event: string, detail: Record<string, unknown> = {}) => {
      liveTrace(event, { route: route.id, into: route.target, ...detail })
    }
    return {
      onSpeechStart: (utterance) => {
        if (this.isSuperseded(generation)) return
        trace('speech-start', { utterance })
        conversation.speechStarted(route.id, utterance)
      },
      onSpeechEnd: (utterance) => {
        if (this.isSuperseded(generation)) return
        trace('speech-end', { utterance })
        conversation.speechEnded(route.id, utterance)
      },
      onAudio: (pcm16, response) => {
        if (this.isSuperseded(generation)) return
        trace('audio', { generation: response, bytes: pcm16.byteLength })
        conversation.audio(route.id, response, pcm16)
      },
      onSourceTranscript: (transcription, finished, utterance) => {
        if (this.isSuperseded(generation)) return
        trace('source-transcript', {
          utterance,
          finished,
          length: transcription.text?.length ?? 0,
          language: transcription.languageCode,
        })
        conversation.sourceTranscription(
          route.id,
          utterance,
          transcription,
          finished,
        )
      },
      onTranslationTranscript: (transcription, response) => {
        if (this.isSuperseded(generation)) return
        trace('translation-transcript', {
          generation: response,
          length: transcription.text?.length ?? 0,
        })
        conversation.translationTranscription(route.id, response, transcription)
      },
      onInterimTranscript: (transcription, utterance) => {
        if (this.isSuperseded(generation)) return
        trace('interim-transcript', {
          utterance,
          length: transcription.text?.length ?? 0,
          language: transcription.languageCode,
        })
        conversation.interimTranscription(route.id, utterance, transcription)
      },
      onInterrupted: (response) => {
        if (this.isSuperseded(generation)) return
        trace('interrupted', { generation: response })
        conversation.interrupted(route.id, response)
      },
      onGenerationComplete: (response) => {
        if (this.isSuperseded(generation)) return
        trace('generation-complete', { generation: response })
        conversation.generationComplete(route.id, response)
      },
      onTurnEnd: (utterance, response) => {
        if (this.isSuperseded(generation)) return
        trace('turn-end', { utterance, generation: response })
        conversation.routeTurnEnd(route.id, utterance, response)
      },
      onError: () => {
        void this.fail(sessionError('live-connection-failed'), generation)
      },
      onClosed: (expected) => {
        if (!expected) void this.fail(sessionError('live-disconnected'), generation)
      },
    }
  }

  // --- Microphone -----------------------------------------------------------

  /**
   * Send one captured chunk to every open route.
   *
   * Both sockets always receive something, never nothing: a gap in the stream
   * starves the API's end-of-speech detection, and the speaker's turn then
   * cannot close. What they receive is the room, or silence standing in for it.
   *
   * The room is replaced by silence only while translated speech is physically
   * audible, because it comes out of the same speakers this microphone is
   * listening to and feeding it back would make the session interpret itself.
   * That is the only reason, which is why it is no longer done for the whole of
   * "translating" as well: nothing is audible between the end of somebody's
   * sentence and the start of the reply, and closing the microphone across that
   * gap is a large part of why a second person so often could not get a word in.
   *
   * The echo-gate path remains available behind `BARGE_IN_ENABLED`, but the
   * normal-conversation configuration below suppresses all room audio while
   * the speakers or their short echo tail are active.
   */
  private sendCapture(
    generation: number,
    samples: Float32Array,
    sampleRate: number,
  ): void {
    if (this.isSuperseded(generation) || this.routes.length === 0) return

    // Auto mode has learned the other language but the socket that answers in
    // it is still opening. A reply now could only be interpreted one way, so
    // the room waits out that bounded handshake.
    const handshake = this.counterpartStartupPromise !== null
    const translating =
      MUTE_WHILE_TRANSLATING && this.conversation.phase === 'translating'
    if (handshake || translating) {
      this.echoGate.setSpeaking(false)
      this.broadcast(this.silence(samples.length), sampleRate)
      return
    }

    // The short tail after playback is treated exactly like playback and
    // guarded against our own speakers.
    const speakers = this.speakersBusy || Date.now() < this.captureResumeAt

    // Normal alternating conversation is the current product contract. The
    // experimental echo gate repeatedly interpreted continuing speech and
    // speaker residue as barge-in in the real traces, which committed partial
    // turns and fed their remainder into a new turn. Keep both Live routes fed
    // with silence while output is audible; the microphone resumes as soon as
    // playback and its short echo tail have ended.
    if (speakers && !BARGE_IN_ENABLED) {
      this.echoGate.setSpeaking(false)
      this.broadcast(this.silence(samples.length), sampleRate)
      return
    }

    this.echoGate.setSpeaking(speakers)
    const decision = this.echoGate.inspect(samples)

    if (decision === 'pass') {
      this.broadcast(samples, sampleRate)
      return
    }
    if (decision === 'suppress') {
      this.broadcast(this.silence(samples.length), sampleRate)
      return
    }

    // Somebody is talking over the translation. Human speech outranks
    // synthesized speech: the speakers stop, the turn being spoken is committed
    // as it stands, and the words that were held back while the interruption
    // was being confirmed go out so the first one is not lost.
    const held = this.echoGate.takePrebuffer()
    liveTrace('barge-in', { chunks: held.length })
    this.conversation.bargeIn()
    this.speakersBusy = false
    // Deliberately after `bargeIn`: flushing the queue reports playback as
    // ended, which arms the post-playback guard. There is nothing left to guard
    // against, and the person interrupting must be heard now.
    this.captureResumeAt = 0
    this.echoGate.setSpeaking(false)
    for (const chunk of held) this.broadcast(chunk, sampleRate)
  }

  private broadcast(samples: Float32Array, sampleRate: number): void {
    const chunk = encodeCaptureChunk(samples, sampleRate, INPUT_SAMPLE_RATE)
    for (const route of this.routes) route.transport?.sendAudioChunk(chunk)
  }

  /** Reusable buffer of zeroes matching the current capture chunk length. */
  private silence(length: number): Float32Array {
    if (this.silentChunk?.length !== length) {
      this.silentChunk = new Float32Array(length)
    }
    return this.silentChunk
  }

  // --- Speakers -------------------------------------------------------------

  private playAudio(pcm16: Uint8Array): boolean {
    try {
      return this.playback?.enqueue(pcm16) ?? false
    } catch {
      // The output device failing is not a reason to stop interpreting. The
      // speakers still see what was said and translated, and the turn closes
      // on the routes going quiet instead of on playback.
      return false
    }
  }

  private endAudio(): void {
    try {
      this.playback?.endStream()
    } catch {
      // The scheduler's idle fallback still ends the stream.
    }
  }

  private flushAudio(): void {
    try {
      this.playback?.flush()
    } catch {
      // Dropping stale audio is best-effort; the queue is abandoned either way.
    }
  }

  private onPlaybackStart(generation: number): void {
    if (this.isSuperseded(generation)) return
    this.speakersBusy = true
    liveTrace('playback-start')
    this.conversation.playbackStarted()
  }

  /**
   * Translated speech has physically finished.
   *
   * The microphone reopens after a short guard, which is not part of playing
   * the translation: the conversation is already listening again by then.
   */
  private onPlaybackEnd(generation: number): void {
    if (this.isSuperseded(generation)) return
    this.speakersBusy = false
    this.captureResumeAt = Date.now() + PLAYBACK_ECHO_GUARD_MS
    liveTrace('playback-end')
    this.conversation.playbackEnded()
  }

  // --- Teardown -------------------------------------------------------------

  private isSuperseded(generation: number): boolean {
    return generation !== this.generation
  }

  private async fail(cause: unknown, generation: number): Promise<void> {
    if (this.isSuperseded(generation)) return
    this.generation += 1
    this.error = toSessionError(cause)
    this.lifecycle = 'error'
    await this.teardownResources()
    this.emit()
  }

  private async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    const startupPromise = this.startupPromise
    const counterpartStartupPromise = this.counterpartStartupPromise
    const shutdownPromise = (async () => {
      await this.teardownResources()
      await Promise.allSettled([
        startupPromise ?? Promise.resolve(),
        counterpartStartupPromise ?? Promise.resolve(),
      ])
      await this.teardownResources()
    })()
    this.shutdownPromise = shutdownPromise
    try {
      await shutdownPromise
    } finally {
      if (this.shutdownPromise === shutdownPromise) this.shutdownPromise = null
    }
  }

  private async teardownResources(): Promise<void> {
    if (this.resourceTeardownPromise) return this.resourceTeardownPromise

    const {
      abortController,
      counterpartAbortController,
      routes,
      capture,
      playback,
    } = this
    this.abortController = null
    this.counterpartAbortController = null
    this.counterpartRequest += 1
    this.counterpartRouteId = null
    this.routes = []
    this.capture = null
    this.playback = null
    this.speakersBusy = false
    this.captureResumeAt = 0
    this.silentChunk = null
    this.echoGate.reset()
    this.conversation.reset()

    const teardownPromise = (async () => {
      abortController?.abort()
      counterpartAbortController?.abort()
      for (const route of routes) route.transport?.close()
      await Promise.allSettled([
        Promise.resolve().then(() => capture?.stop()),
        Promise.resolve().then(() => playback?.dispose()),
      ])
    })()
    this.resourceTeardownPromise = teardownPromise
    try {
      await teardownPromise
    } finally {
      if (this.resourceTeardownPromise === teardownPromise) {
        this.resourceTeardownPromise = null
      }
    }
  }

  private createSnapshot(): TranslationSessionSnapshot {
    return {
      state: this.state,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      counterpartLanguage: this.conversation.counterpartLanguage,
      error: this.error,
      turns: this.conversation.turns,
      interimTranscript: this.conversation.interimTranscript,
    }
  }

  private emit(): void {
    const previous = this.snapshot
    this.snapshot = this.createSnapshot()
    if (previous.state !== this.snapshot.state) {
      liveTrace('state', {
        from: previous.state,
        to: this.snapshot.state,
        turns: this.snapshot.turns.length,
        pair: `${this.sourceLanguage}<->${this.targetLanguage}`,
        counterpart: this.snapshot.counterpartLanguage,
      })
    }
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
