import {
  CAPTURE_CHUNK_MS,
  DEFAULT_LIVE_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  INPUT_SAMPLE_RATE,
  MAX_UNOWNED_AUDIO_BYTES,
  OUTPUT_SAMPLE_RATE,
  PLAYBACK_ECHO_GUARD_MS,
  PLAYBACK_WATCHDOG_SLACK_MS,
} from './config'
import { sessionError, toSessionError } from './errors'
import {
  connectLiveTransport,
  type LiveTransport,
  type LiveTransportEvents,
} from './liveTransport'
import {
  INITIAL_SESSION_STATE,
  canStart,
  isSessionActive,
  nextSessionState,
  type SessionEvent,
} from './sessionMachine'
import { finalizeOpenTurns, isNearDuplicateTranscript } from './transcript'
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
import {
  AUTO_SOURCE_LANGUAGE,
  languageCodesMatch,
  resolveTranscriptLanguage,
} from '../../types'
import type {
  InterimTranscript,
  SessionError,
  SessionState,
  SourceLanguageCode,
  TranscriptKind,
  TranscriptTurn,
  SupportedLanguageCode,
  TranslationSessionSnapshot,
} from './types'

/** How long a committed turn shadows an identical one from another route. */
const DUPLICATE_TURN_WINDOW_MS = 2500

/**
 * Completed utterances in an unfamiliar language before auto mode moves the
 * conversation onto it.
 *
 * The first counterpart is adopted immediately — there is no working pair to
 * protect and the reply has to be interpreted. Replacing one is different: a
 * single mislabelled turn would close a socket the conversation is using, so
 * the language has to hold up across a second utterance first.
 */
const COUNTERPART_SWITCH_UTTERANCES = 2

/** The pieces of a transcription this controller reads. */
interface TranscriptionLike {
  text?: string
  languageCode?: string
}

interface CommittedTurnDigest {
  kind: TranscriptKind
  languageCode: string
  text: string
  at: number
}

/**
 * Whether a route may be heard for the utterance it is working on.
 *
 * `pending` means the evidence has not arrived yet, and audio produced while it
 * lasts is held rather than played: releasing it and retracting later would mean
 * both sides of the pair are briefly audible, which is the one thing an
 * interpreter must never do.
 */
type RouteVerdict = 'pending' | 'play' | 'mute'

/** What one route has gathered about the utterance currently in progress. */
interface RouteTurn {
  sourceText: string
  translationText: string
  /** The language being spoken, once it is known and belongs to the pair. */
  language: SupportedLanguageCode | null
  audio: Uint8Array[]
  audioBytes: number
  verdict: RouteVerdict
  /** Whether another route was already being heard for this utterance. */
  contended: boolean
  /** Cleared once this utterance's reported language has been disproved. */
  languageTrusted: boolean
}

/** One open Live socket, translating everything it hears into `target`. */
interface Route {
  readonly id: number
  readonly target: SupportedLanguageCode
  transport: LiveTransport | null
  turn: RouteTurn
}

function createRouteTurn(): RouteTurn {
  return {
    sourceText: '',
    translationText: '',
    language: null,
    audio: [],
    audioBytes: 0,
    verdict: 'pending',
    contended: false,
    languageTrusted: true,
  }
}

export interface TranslationSessionOptions {
  /** Defaults to per-utterance auto detection. */
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
 * Owns a two-way interpreter session.
 *
 * A Live Translate session has one `targetLanguageCode` and no source field, so
 * a single socket can only ever translate *into* one language. A conversation
 * between an A speaker and a B speaker therefore needs two of them — one
 * rendering everything into B, one rendering everything into A — both listening
 * to the same microphone for the whole session. Neither is ever restarted
 * between turns; which of them speaks is decided per utterance.
 *
 * `echoTargetLanguage: false` is the API's own half of that decision: a route
 * stays silent when the language being spoken is already its target. This class
 * is the other half, because that only holds while the model's language
 * identification is right. Every route reports what it heard, what it produced,
 * and its audio; exactly one is elected to be heard, and audio is held until
 * that election is settled. Text is never held: both transcripts are published
 * whatever the verdict.
 */
export class TranslationSession {
  private state: SessionState = INITIAL_SESSION_STATE
  private error: SessionError | null = null
  private transcript: TranscriptTurn[] = []
  private interimTranscript: InterimTranscript | null = null
  private sourceLanguage: SourceLanguageCode
  private targetLanguage: SupportedLanguageCode
  private readonly tokenProvider: LiveTokenProvider
  private readonly modelOverride?: string

  private capture: MicrophoneCapture | null = null
  private playback: PlaybackScheduler | null = null
  private routes: Route[] = []
  /**
   * The other language of the conversation: the selected source, or in auto
   * mode the first language heard that was not the target.
   */
  private counterpart: SupportedLanguageCode | null = null
  private counterpartRouteId: number | null = null
  /** Run of completed utterances in a language the pair does not carry. */
  private unfamiliar: {
    language: SupportedLanguageCode
    utterances: number
  } | null = null
  private abortController: AbortController | null = null
  private counterpartAbortController: AbortController | null = null
  private startupPromise: Promise<void> | null = null
  private counterpartStartupPromise: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null
  private resourceTeardownPromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null

  private generation = 0
  private counterpartRequest = 0
  private routeCounter = 0
  private turnCounter = 0
  private disposed = false
  /** The route currently allowed to be heard, if any. */
  private audioOwner: number | null = null
  /** The route whose partial transcription drives the live caption. */
  private interimOwner: number | null = null
  private playbackActive = false
  private playbackWatchdog: ReturnType<typeof setTimeout> | null = null
  private captureResumeAt = 0
  private recentTurns: CommittedTurnDigest[] = []
  private silentChunk: Float32Array | null = null
  private readonly listeners = new Set<SessionListener>()
  private snapshot: TranslationSessionSnapshot

  constructor(options: TranslationSessionOptions = {}) {
    this.sourceLanguage = options.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE
    this.targetLanguage = options.targetLanguage ?? DEFAULT_TARGET_LANGUAGE
    this.tokenProvider = options.tokenProvider ?? createLiveTokenProvider()
    this.modelOverride = options.model
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
    await this.launch(sourceLanguage, targetLanguage)
  }

  private async launch(
    sourceLanguage: SourceLanguageCode,
    targetLanguage: SupportedLanguageCode,
  ): Promise<void> {
    const requestGeneration = this.generation
    const cleanupPromise = this.shutdownPromise ?? this.resourceTeardownPromise
    if (cleanupPromise) await cleanupPromise

    if (
      this.disposed ||
      requestGeneration !== this.generation ||
      !canStart(this.state)
    ) {
      return
    }

    if (
      sourceLanguage !== AUTO_SOURCE_LANGUAGE &&
      languageCodesMatch(sourceLanguage, targetLanguage)
    ) {
      this.error = sessionError('unknown')
      this.applyEvent('FAIL')
      this.emit()
      return
    }

    this.sourceLanguage = sourceLanguage
    this.targetLanguage = targetLanguage
    // An explicit selection is the conversation pair. Auto mode learns it from
    // the first speaker who is not already speaking the target language.
    this.counterpart =
      sourceLanguage === AUTO_SOURCE_LANGUAGE ? null : sourceLanguage
    this.error = null
    this.interimTranscript = null
    this.applyEvent('START')
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
    this.counterpartRequest += 1
    this.applyEvent('STOP')
    await this.shutdown()
    this.transcript = finalizeOpenTurns(this.transcript)
    this.interimTranscript = null
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
    this.transcript = []
    this.interimTranscript = null
    this.recentTurns = []
    this.emit()
  }

  private async startAttempt(
    generation: number,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const playback = await createPlaybackScheduler({
        sampleRate: OUTPUT_SAMPLE_RATE,
        onPlaybackStart: () => this.onPlaybackStart(generation),
        onPlaybackDrained: () => this.onPlaybackDrained(generation),
      })
      if (this.isSuperseded(generation)) {
        await playback.dispose()
        return
      }
      this.playback = playback

      const capture = await startMicrophoneCapture({
        targetSampleRate: INPUT_SAMPLE_RATE,
        chunkMs: CAPTURE_CHUNK_MS,
        onChunk: (samples, sampleRate) => {
          if (this.isSuperseded(generation) || this.routes.length === 0) {
            return
          }
          // The translated speech comes out of the same speakers the microphone
          // is listening to, so while it plays the room is replaced with
          // silence rather than dropped. A gap in the stream starves the API's
          // end-of-speech detection, which then cannot close the turn until
          // playback finishes — the speaker's own audio keeps their turn open.
          const muted = this.playbackActive || Date.now() < this.captureResumeAt
          const chunk = encodeCaptureChunk(
            muted ? this.silence(samples.length) : samples,
            sampleRate,
            INPUT_SAMPLE_RATE,
          )
          for (const route of this.routes) {
            route.transport?.sendAudioChunk(chunk)
          }
        },
      })
      if (this.isSuperseded(generation)) {
        await capture.stop()
        return
      }
      this.capture = capture

      // Open sequentially. Simultaneous Live handshakes proved unreliable in
      // real browsers even though independent token requests are supported.
      const primary = await this.openRoute({
        generation,
        signal: abortController.signal,
        target: this.targetLanguage,
        expects: this.counterpart ?? AUTO_SOURCE_LANGUAGE,
      })
      if (this.isSuperseded(generation)) {
        primary.transport?.close()
        return
      }
      this.routes = [primary]

      // The return direction opens with the session, not on demand: the reply
      // must be interpreted the moment it is spoken, and a socket opened at
      // that point would miss the first seconds of it.
      if (this.counterpart) {
        const back = await this.openRoute({
          generation,
          signal: abortController.signal,
          target: this.counterpart,
          expects: this.targetLanguage,
        })
        if (this.isSuperseded(generation)) {
          back.transport?.close()
          return
        }
        this.counterpartRouteId = back.id
        this.routes = [primary, back]
      }

      this.applyEvent('CONNECTED')
      this.emit()
    } catch (cause) {
      if (!this.isSuperseded(generation)) await this.fail(cause, generation)
    }
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
      turn: createRouteTurn(),
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

  private routeEvents(generation: number, route: Route): LiveTransportEvents {
    return {
      onAudio: (pcm16) => {
        if (this.isSuperseded(generation)) return
        this.receiveAudio(route, pcm16)
      },
      onSourceTranscript: (transcription) => {
        if (this.isSuperseded(generation)) return
        route.turn.sourceText = transcription.text?.trim() ?? ''
        this.observeSpokenLanguage(route, transcription)
        const committed = this.recordTurn('source', transcription, route)
        this.settleRoute(route)
        // Both routes report the same speech, so only the one that became a row
        // counts as an utterance.
        if (committed) void this.considerCounterpart(generation, transcription)
      },
      onTranslationTranscript: (transcription) => {
        if (this.isSuperseded(generation)) return
        route.turn.translationText = transcription.text?.trim() ?? ''
        this.settleRoute(route)
        // A readback of the speaker's own words is not a translation, and a row
        // for it would only repeat the source row. Everything else is shown,
        // whether or not this route was the one allowed to speak it.
        if (!this.isParroting(route)) {
          this.recordTurn('translation', transcription, route)
        }
      },
      onInterimTranscript: (transcription) => {
        if (this.isSuperseded(generation)) return
        this.observeSpokenLanguage(route, transcription)
        this.settleRoute(route)
        // Both routes transcribe the same speech. The first to describe this
        // utterance keeps the caption, so it does not flicker between two
        // slightly different readings of the same words.
        if (this.interimOwner === null) this.interimOwner = route.id
        if (this.interimOwner === route.id) this.recordInterim(transcription)
      },
      onInterrupted: () => {
        if (this.isSuperseded(generation)) return
        this.discardRouteAudio(route)
        if (this.audioOwner !== route.id) return
        // Only the route being heard may drop what is already scheduled.
        this.audioOwner = null
        try {
          this.playback?.flush()
        } catch {
          // Dropping stale audio is best-effort; the queue is abandoned either
          // way and the drain callback still returns the session to listening.
        }
      },
      onTurnEnd: () => {
        if (this.isSuperseded(generation)) return
        this.finishRouteTurn(route)
      },
      onError: () => {
        void this.fail(sessionError('live-connection-failed'), generation)
      },
      onClosed: (expected) => {
        if (!expected) void this.fail(sessionError('live-disconnected'), generation)
      },
    }
  }

  /**
   * Note the language of the speech a route is reporting, if it is one of the
   * two languages this conversation is between.
   *
   * A configured pair is never replaced by model metadata: a route that reports
   * some third language is reporting a mistake, and the utterance is treated as
   * unidentified rather than as a new language. Auto mode before it has settled
   * on a counterpart is the one case where an unfamiliar language is real.
   */
  private observeSpokenLanguage(
    route: Route,
    transcription: TranscriptionLike,
  ): void {
    if (!route.turn.languageTrusted) return
    const detected = resolveTranscriptLanguage(
      transcription.languageCode,
      transcription.text ?? '',
    )
    if (!detected) return

    if (languageCodesMatch(detected, this.targetLanguage)) {
      route.turn.language = this.targetLanguage
    } else if (
      this.counterpart &&
      languageCodesMatch(detected, this.counterpart)
    ) {
      route.turn.language = this.counterpart
    } else if (
      this.sourceLanguage === AUTO_SOURCE_LANGUAGE &&
      this.counterpart === null
    ) {
      route.turn.language = detected
    }
  }

  /** Whether this route handed back the speech it was given. */
  private isParroting(route: Route): boolean {
    const { sourceText, translationText } = route.turn
    return Boolean(
      sourceText &&
        translationText &&
        isNearDuplicateTranscript(sourceText, translationText),
    )
  }

  /**
   * Judge a route on everything known about the utterance so far.
   *
   * Parroting outranks everything: a route handing the speaker their own words
   * back has nothing to interpret whatever language it reported, and that is
   * precisely the case where the reported language was wrong. Otherwise the
   * language decides, which is the common path and settles from the first
   * partial transcription — before any audio, so nothing has to be held. Only
   * when the API reports no usable language code at all does a route have to
   * prove itself by producing something other than what it was given.
   */
  private judge(route: Route): RouteVerdict {
    if (this.isParroting(route)) return 'mute'
    if (route.turn.language) {
      return languageCodesMatch(route.turn.language, route.target)
        ? 'mute'
        : 'play'
    }
    return route.turn.translationText ? 'play' : 'pending'
  }

  /**
   * Re-judge a route and grant or withdraw the floor accordingly.
   *
   * Verdicts are never latched: the evidence a route was let in on can be
   * contradicted by what it goes on to produce, and the utterance then belongs
   * to the other route of the pair after all.
   */
  private settleRoute(route: Route): void {
    const verdict = this.judge(route)
    route.turn.verdict = verdict
    if (verdict === 'pending') return

    if (verdict === 'mute') {
      if (this.audioOwner !== route.id) return
      // This route contradicted the evidence it was let in on, so what it
      // produced is dropped and the utterance is offered to the other route.
      this.discardRouteAudio(route)
      this.audioOwner = null
      try {
        this.playback?.flush()
      } catch {
        // Best-effort: the watchdog still returns the session to listening.
      }
      for (const other of this.routes) {
        if (other.id === route.id) continue
        // The language every route was judged on came from the same reading of
        // the same speech, and this route just disproved it. Distrust it for
        // the rest of the utterance — it is reported again with every
        // transcription — and judge the others on what they produce instead.
        other.turn.languageTrusted = false
        other.turn.language = null
        other.turn.contended = false
        this.settleRoute(other)
      }
      return
    }

    // One translated voice per utterance. A route that would be heard while
    // another already holds the floor keeps its audio rather than adding to it.
    if (this.audioOwner === null) this.takeFloor(route)
  }

  private takeFloor(route: Route): void {
    this.audioOwner = route.id
    for (const other of this.routes) {
      if (other.id !== route.id) other.turn.contended = true
    }
    const held = route.turn.audio
    route.turn.audio = []
    route.turn.audioBytes = 0
    for (const chunk of held) this.playAudio(chunk)
  }

  private receiveAudio(route: Route, pcm16: Uint8Array): void {
    const turn = route.turn
    if (this.audioOwner === route.id) {
      this.playAudio(pcm16)
      return
    }

    // Held rather than dropped: a route that is not being heard right now can
    // still turn out to be the one this utterance belongs to.
    turn.audio.push(pcm16)
    turn.audioBytes += pcm16.byteLength
    while (turn.audioBytes > MAX_UNOWNED_AUDIO_BYTES && turn.audio.length > 1) {
      turn.audioBytes -= turn.audio.shift()?.byteLength ?? 0
    }
  }

  private playAudio(pcm16: Uint8Array): void {
    try {
      this.playback?.enqueue(pcm16)
      this.armPlaybackWatchdog()
    } catch {
      // The output device failing is not a reason to stop interpreting. The
      // speaker still sees what was said and translated, and the watchdog still
      // returns the session to listening.
    }
  }

  private discardRouteAudio(route: Route): void {
    route.turn.audio = []
    route.turn.audioBytes = 0
  }

  /**
   * Close out an utterance on one route.
   *
   * Audio still held at this point was never heard from anyone else, so the
   * route that produced it is the only interpretation of the utterance there is
   * and it is released rather than lost.
   */
  private finishRouteTurn(route: Route): void {
    if (
      route.turn.verdict !== 'mute' &&
      route.turn.audio.length > 0 &&
      !route.turn.contended
    ) {
      this.takeFloor(route)
    }
    this.discardRouteAudio(route)
    if (this.audioOwner === route.id) this.audioOwner = null
    if (this.interimOwner === route.id) {
      this.interimOwner = null
      if (this.interimTranscript) {
        this.interimTranscript = null
        this.emit()
      }
    }
    route.turn = createRouteTurn()
  }

  /**
   * Auto mode: adopt the language of the first speaker who is not already
   * speaking the target, and open the route that answers them.
   *
   * The pair is then kept. Replacing it on every guess churned sockets mid
   * conversation, and a language the model reported once is not evidence that
   * the conversation changed — a run of utterances in it is.
   */
  private async considerCounterpart(
    generation: number,
    transcription: TranscriptionLike,
  ): Promise<void> {
    if (this.sourceLanguage !== AUTO_SOURCE_LANGUAGE) return
    const detected = resolveTranscriptLanguage(
      transcription.languageCode,
      transcription.text ?? '',
    )
    if (
      !detected ||
      languageCodesMatch(detected, this.targetLanguage) ||
      (this.counterpart && languageCodesMatch(detected, this.counterpart))
    ) {
      // The conversation is where the session thinks it is.
      this.unfamiliar = null
      return
    }

    this.unfamiliar =
      this.unfamiliar && languageCodesMatch(this.unfamiliar.language, detected)
        ? { language: detected, utterances: this.unfamiliar.utterances + 1 }
        : { language: detected, utterances: 1 }

    if (
      this.counterpart &&
      this.unfamiliar.utterances < COUNTERPART_SWITCH_UTTERANCES
    ) {
      return
    }
    this.unfamiliar = null
    await this.setCounterpart(generation, detected)
  }

  /**
   * Point the return direction at `language`.
   *
   * The old route is closed before the replacement opens, so a third language
   * can never be spoken through two routes at once. This route is an addition
   * to a session that is already interpreting, so a failure degrades it rather
   * than ending it: the claim is released and the next utterance tries again.
   */
  private async setCounterpart(
    generation: number,
    language: SupportedLanguageCode,
  ): Promise<void> {
    if (this.isSuperseded(generation) || this.counterpart === language) return

    const request = (this.counterpartRequest += 1)
    this.counterpart = language
    this.counterpartAbortController?.abort()
    this.counterpartAbortController = null
    const existing = this.routes.find(
      (candidate) => candidate.id === this.counterpartRouteId,
    )
    if (existing) this.closeRoute(existing)
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
        if (this.isSuperseded(generation) || request !== this.counterpartRequest) {
          route.transport?.close()
          return
        }
        this.counterpartRouteId = route.id
        this.routes = [...this.routes, route]
      } catch {
        if (!this.isSuperseded(generation) && request === this.counterpartRequest) {
          this.counterpart = null
          this.counterpartRouteId = null
        }
      }
    })()
    this.counterpartStartupPromise = startupPromise
    try {
      await startupPromise
    } finally {
      if (this.counterpartStartupPromise === startupPromise) {
        this.counterpartStartupPromise = null
      }
    }
  }

  private closeRoute(route: Route): void {
    this.routes = this.routes.filter((candidate) => candidate !== route)
    if (this.audioOwner === route.id) this.audioOwner = null
    if (this.interimOwner === route.id) this.interimOwner = null
    route.transport?.close()
    route.transport = null
  }

  /**
   * Commit one side of a spoken turn.
   *
   * Source and translation arrive separately and seconds apart — the speaker's
   * words are transcribed long before the model has finished speaking the
   * translation — so each is committed as soon as it is known rather than being
   * held back for its partner. Neither depends on playback: text the API
   * produced is shown whether or not this route was allowed to speak it.
   *
   * Returns whether this was new speech rather than the other route's report of
   * something already on screen.
   */
  private recordTurn(
    kind: TranscriptKind,
    transcription: TranscriptionLike,
    route: Route,
  ): boolean {
    const text = transcription.text?.trim() ?? ''
    if (!text) return false

    const languageCode =
      resolveTranscriptLanguage(transcription.languageCode, text) ??
      transcription.languageCode ??
      (kind === 'translation' ? route.target : 'und')
    const now = Date.now()
    if (this.isDuplicateTurn(kind, languageCode, text, now)) return false

    this.turnCounter += 1
    const turn: TranscriptTurn = {
      id: `turn-${this.turnCounter}`,
      kind,
      text,
      languageCode,
      isFinal: true,
      createdAt: now,
    }
    this.transcript = [...this.transcript, turn]
    if (kind === 'source') {
      // The live caption has been superseded by the row it was previewing.
      this.interimTranscript = null
    }
    this.emit()
    return true
  }

  /**
   * Every open route hears the same microphone, so one sentence is reported by
   * both of them. The first to arrive owns the row.
   */
  private isDuplicateTurn(
    kind: TranscriptKind,
    languageCode: string,
    text: string,
    now: number,
  ): boolean {
    this.recentTurns = this.recentTurns.filter(
      (entry) => now - entry.at < DUPLICATE_TURN_WINDOW_MS,
    )
    const duplicate = this.recentTurns.some(
      (entry) =>
        entry.kind === kind &&
        languageCodesMatch(entry.languageCode, languageCode) &&
        isNearDuplicateTranscript(entry.text, text),
    )
    if (!duplicate) {
      this.recentTurns = [...this.recentTurns, { kind, languageCode, text, at: now }]
    }
    return duplicate
  }

  /** Reusable buffer of zeroes matching the current capture chunk length. */
  private silence(length: number): Float32Array {
    if (this.silentChunk?.length !== length) {
      this.silentChunk = new Float32Array(length)
    }
    return this.silentChunk
  }

  private recordInterim(transcription: TranscriptionLike): void {
    const text = transcription.text?.trim() ?? ''
    if (!text) return
    this.interimTranscript = {
      text,
      languageCode:
        resolveTranscriptLanguage(transcription.languageCode, text) ??
        transcription.languageCode ??
        'und',
    }
    this.emit()
  }

  private isSuperseded(generation: number): boolean {
    return generation !== this.generation
  }

  private applyEvent(event: SessionEvent): boolean {
    const next = nextSessionState(this.state, event)
    if (next === null || next === this.state) return false
    this.state = next
    return true
  }

  private onPlaybackStart(generation: number): void {
    if (this.isSuperseded(generation)) return
    this.playbackActive = true
    this.armPlaybackWatchdog()
    if (this.applyEvent('OUTPUT_START')) this.emit()
  }

  private onPlaybackDrained(generation: number): void {
    if (this.isSuperseded(generation)) return
    this.releasePlayback()
  }

  /**
   * Bound how long the session may believe it is playing.
   *
   * The microphone is silenced for exactly that long, so a completion callback
   * that never arrives would leave it deaf and the session permanently busy.
   * The deadline is the playback scheduler's own clock rather than a guess: it
   * knows how much audio is still queued, and the slack only has to cover
   * delivering the callback once that runs out.
   */
  private armPlaybackWatchdog(): void {
    const playback = this.playback
    if (!playback) return
    this.clearPlaybackWatchdog()
    this.playbackWatchdog = setTimeout(
      () => {
        this.playbackWatchdog = null
        this.releasePlayback()
      },
      playback.remainingMs() + PLAYBACK_WATCHDOG_SLACK_MS,
    )
  }

  private clearPlaybackWatchdog(): void {
    if (this.playbackWatchdog !== null) {
      clearTimeout(this.playbackWatchdog)
      this.playbackWatchdog = null
    }
  }

  /** Return the microphone and the session state to listening. Idempotent. */
  private releasePlayback(): void {
    this.clearPlaybackWatchdog()
    if (this.playbackActive) {
      this.playbackActive = false
      this.captureResumeAt = Date.now() + PLAYBACK_ECHO_GUARD_MS
    }
    if (this.applyEvent('OUTPUT_END')) this.emit()
  }

  private async fail(cause: unknown, generation: number): Promise<void> {
    if (this.isSuperseded(generation)) return
    this.generation += 1
    this.counterpartRequest += 1
    this.error = toSessionError(cause)
    this.applyEvent('FAIL')
    await this.teardownResources()
    this.transcript = finalizeOpenTurns(this.transcript)
    this.interimTranscript = null
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
    this.routes = []
    this.counterpart = null
    this.counterpartRouteId = null
    this.unfamiliar = null
    this.audioOwner = null
    this.interimOwner = null
    this.capture = null
    this.playback = null
    this.clearPlaybackWatchdog()
    this.playbackActive = false
    this.captureResumeAt = 0
    this.silentChunk = null
    // A new session must be free to repeat a phrase the last one committed.
    this.recentTurns = []

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
      error: this.error,
      transcript: this.transcript,
      interimTranscript: this.interimTranscript,
    }
  }

  private emit(): void {
    this.snapshot = this.createSnapshot()
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
