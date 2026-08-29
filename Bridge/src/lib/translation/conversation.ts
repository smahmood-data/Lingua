import { isNearDuplicateTranscript } from './transcript'
import { liveTrace } from './debug'
import { UTTERANCE_JOIN_MS } from './config'
import {
  languageCodesMatch,
  resolveTranscriptLanguage,
  scriptSupportsLanguage,
  textHasScriptEvidence,
} from '../../types'
import type {
  ConversationPhase,
  ConversationTurn,
  InterimTranscript,
  SupportedLanguageCode,
  TurnStatus,
} from './types'

/**
 * Retained for compatibility with older diagnostics. Route arbitration is no
 * longer decided by this timer: the real traces showed the correct route could
 * arrive just after it and lose the turn. Contested audio now waits for route
 * evidence or a route-complete signal.
 */
export const CONTESTED_AUDIO_HOLD_MS = 250

/** Ceiling on contested audio retained while route evidence is unresolved. */
const MAX_HELD_AUDIO_BYTES = 24_000 * 2 * 2

/**
 * Bound on how long a turn with nothing to interpret waits for a route that
 * has not said anything about it.
 *
 * Both routes hear the same microphone, so both normally report every
 * utterance and such a turn closes the moment the second one is done — this
 * never runs. It exists because a route that stays silent about an utterance
 * would otherwise keep it open, and the next person's words would join it.
 */
const SILENT_TURN_SETTLE_MS = UTTERANCE_JOIN_MS

/** Auto evidence needed for one clear first observation. */
export const AUTO_INITIAL_EVIDENCE_SCORE = 4
/** One long observation can replace a stale Auto counterpart. */
export const AUTO_SWITCH_EVIDENCE_SCORE = 20
/** Two consistent shorter observations can also replace it. */
export const AUTO_REPEATED_EVIDENCE_SCORE = 8

/** The pieces of a Live transcription this module reads. */
export interface TranscriptionLike {
  text?: string
  languageCode?: string
}

/** Everything the coordinator asks the outside world to do. */
export interface ConversationOutput {
  /** Schedule one PCM16 chunk. False means it could not be scheduled. */
  playAudio: (pcm16: Uint8Array) => boolean
  /** The owning route produced its last chunk for the current turn. */
  endAudio: () => void
  /** Abandon audio that is queued or already playing. */
  flushAudio: () => void
  /** The conversation changed; subscribers should be told. */
  changed: () => void
  /** Auto mode adopted or revised the other language of the conversation. */
  counterpartDetected: (language: SupportedLanguageCode) => void
}

export interface ConversationConfig {
  /** The language the "Translate into" control selects. */
  targetLanguage: SupportedLanguageCode
  /** The other language of the pair, or `null` until auto mode learns it. */
  counterpart: SupportedLanguageCode | null
  /** Whether an unknown language may be adopted as the counterpart. */
  autoDetect: boolean
}

/** One open Live socket, from the conversation's point of view. */
interface RouteState {
  readonly id: number
  readonly target: SupportedLanguageCode
  /** Reporting an utterance right now. */
  active: boolean
  /**
   * Highest utterance id this route has reported that is already committed.
   *
   * A socket can still be finishing an utterance the conversation has closed.
   * What it has left to say belongs to a turn that is over, so it is dropped by
   * id rather than by comparing its text to the previous row.
   */
  committedUtterance: number
  /** Highest model response id from this route that is already committed. */
  committedGeneration: number
}

interface SourceSegment {
  readonly key: string
  readonly routeId: number
  readonly utterance: number
  text: string
  language: SupportedLanguageCode | null
  /** Whether this segment has already contributed to Auto language evidence. */
  observed: boolean
}

/** The utterance currently in progress. */
interface OpenTurn {
  id: string
  createdAt: number
  status: TurnStatus
  /** The utterance id each route is contributing to this turn. */
  utteranceByRoute: Map<number, number>
  /** The model response id each route is contributing to this turn. */
  generationByRoute: Map<number, number>
  sourceByRoute: Map<number, string>
  translationByRoute: Map<number, string>
  sourceSegments: Map<string, SourceSegment>
  translationSegments: Map<string, { routeId: number; text: string }>
  languageByRoute: Map<number, SupportedLanguageCode>
  interimByRoute: Map<number, InterimTranscript>
  /** Highest finalized source segment on each route. */
  sealedUtteranceByRoute: Map<number, number>
  /** Server VAD has found the human end-of-speech boundary. */
  sourceEnded: boolean
  /** The route granted the floor, once one has been. */
  ownerId: number | null
  /** Whether any of its audio actually reached the playback scheduler. */
  audioScheduled: boolean
  /** Whether that audio has physically finished playing. */
  audioFinished: boolean
  /** Audio from a route the language evidence did not favour. */
  heldId: number | null
  held: Uint8Array[]
  heldBytes: number
  holdTimer: ReturnType<typeof setTimeout> | null
  /**
   * Routes that have produced any audio for this utterance.
   *
   * The difference between "the route we expected to hear said nothing" and
   * "the route we expected to hear is talking right now" — which is what
   * decides whether a contested hold may be handed to the other one.
   */
  audioByRoute: Set<number>
  /** Routes that have produced their last audio chunk for this utterance. */
  generated: Set<number>
  /** Routes that have reported the end of this utterance. */
  ended: Set<number>
  settleTimer: ReturnType<typeof setTimeout> | null
}

const STATUS_ORDER: Record<TurnStatus, number> = {
  speaking: 0,
  translating: 1,
  playing: 2,
  complete: 3,
}

function longest(values: Iterable<string>): string {
  let best = ''
  for (const value of values) {
    if (value.length > best.length) best = value
  }
  return best
}

function segmentKey(routeId: number, sequence: number): string {
  return `${routeId}:${sequence}`
}

/** Join finalized ASR segments without duplicating cumulative updates. */
function joinSegments(values: Iterable<string>): string {
  let joined = ''
  for (const value of values) {
    const next = value.trim()
    if (!next) continue
    if (!joined) {
      joined = next
      continue
    }
    if (next.startsWith(joined)) {
      joined = next
      continue
    }
    if (joined.endsWith(next)) continue
    const needsSpace =
      !/\s$/u.test(joined) &&
      !/^[\s,.;:!?،。！？]/u.test(next) &&
      !/[\u3040-\u30ff\u3400-\u9fff]$/u.test(joined) &&
      !/^[\u3040-\u30ff\u3400-\u9fff]/u.test(next)
    joined += `${needsSpace ? ' ' : ''}${next}`
  }
  return joined
}

function evidenceScore(text: string): number {
  return [...text].filter((character) => /[\p{L}\p{N}]/u.test(character)).length
}

/**
 * The one authority on what the conversation is.
 *
 * A Live Translate session has a single `targetLanguageCode` and no source
 * field, so interpreting between two people needs two sockets: one rendering
 * everything into A, one into B. Both hear the same microphone, so both report
 * the same speech and either may produce audio. Everything difficult about this
 * product comes from that, and all of it is decided here.
 *
 * The rule that makes it tractable: at most one turn is open at a time, and
 * every route event is evidence about *that* turn. Routes never create rows,
 * never decide that a new utterance has begun, and never reach the speakers on
 * their own. Two routes describing one sentence therefore cannot become two
 * turns — not because their text is compared, but because there is only one
 * turn for them to describe.
 */
export class ConversationCoordinator {
  private readonly routes = new Map<number, RouteState>()
  private history: ConversationTurn[] = []
  private view: ConversationTurn[] = []
  private open: OpenTurn | null = null
  private interim: InterimTranscript | null = null
  private targetLanguage: SupportedLanguageCode
  private counterpart: SupportedLanguageCode | null = null
  private autoDetect = false
  private autoCandidate: {
    language: SupportedLanguageCode
    score: number
    observations: number
  } | null = null
  private turnCounter = 0
  /**
   * Whether the speakers are producing sound right now.
   *
   * Deliberately not a property of a turn: "playing the translation" is a fact
   * about the audio device, and the UI says it only while that is true.
   */
  private speaking = false
  /** The turn whose translation the speakers are producing. */
  private speakingTurn: string | null = null
  private readonly output: ConversationOutput

  constructor(output: ConversationOutput, config: ConversationConfig) {
    this.output = output
    this.targetLanguage = config.targetLanguage
    // Deliberately not `configure`: nothing may be published before the caller
    // holding this instance has finished constructing itself.
    this.applyConfig(config)
  }

  /** Point the conversation at a language pair. Clears any turn in progress. */
  configure(config: ConversationConfig): void {
    this.applyConfig(config)
    this.publish()
  }

  private applyConfig(config: ConversationConfig): void {
    // Changing either side of the pair makes this a different conversation, so
    // nothing from the previous one may survive into it — not the rows on
    // screen, not the turn numbering, and not a counterpart learned for a pair
    // that no longer exists. Stopping, choosing new languages and starting
    // again has to be indistinguishable from loading the page afresh.
    const pairChanged =
      !languageCodesMatch(this.targetLanguage, config.targetLanguage) ||
      this.counterpart !== config.counterpart ||
      this.autoDetect !== config.autoDetect
    this.discardOpenTurn()
    this.routes.clear()
    if (pairChanged) {
      this.history = []
      this.view = []
      this.turnCounter = 0
    }
    this.targetLanguage = config.targetLanguage
    this.counterpart = config.counterpart
    this.autoDetect = config.autoDetect
    this.autoCandidate = null
  }

  /** Drop everything this session accumulated. Committed history is kept. */
  reset(): void {
    this.discardOpenTurn()
    this.routes.clear()
    if (this.autoDetect) {
      this.counterpart = null
      this.autoCandidate = null
    }
    this.publish()
  }

  clearHistory(): void {
    this.history = []
    this.discardOpenTurn()
    this.publish()
  }

  addRoute(id: number, target: SupportedLanguageCode): void {
    this.routes.set(id, {
      id,
      target,
      active: false,
      committedUtterance: 0,
      committedGeneration: 0,
    })
  }

  /** Remove an Auto return route that is being replaced by better evidence. */
  removeRoute(id: number): void {
    const route = this.routes.get(id)
    if (!route) return
    this.routes.delete(id)
    const open = this.open
    if (open?.heldId === id) this.clearHold(open)
    if (open?.ownerId === id) {
      this.output.flushAudio()
      open.ownerId = null
      open.audioFinished = true
      this.speaking = false
      this.speakingTurn = null
    }
    if (open) this.closeIfSettled()
    this.publish()
  }

  get turns(): ConversationTurn[] {
    return this.view
  }

  get interimTranscript(): InterimTranscript | null {
    return this.interim
  }

  get counterpartLanguage(): SupportedLanguageCode | null {
    return this.counterpart
  }

  get phase(): ConversationPhase {
    // Sound coming out of the speakers is the only thing that means "playing".
    // Not an open turn, not a route still tidying up, not the echo guard.
    if (this.speaking) return 'playing'
    const open = this.open
    if (!open) return 'listening'
    if (
      open.ownerId === null &&
      !open.audioScheduled &&
      open.translationByRoute.size === 0 &&
      this.settledSilent(open)
    ) {
      return 'listening'
    }
    return open.status === 'speaking' ? 'listening' : 'translating'
  }

  // --- Route evidence -------------------------------------------------------

  /**
   * Gemini VAD found the start of one human utterance.
   *
   * Both sockets hear the same microphone, so both report it. Whichever gets
   * there first opens the turn and the other joins it — one utterance is still
   * one turn, because there is only ever one turn open to join.
   */
  speechStarted(routeId: number, utterance: number): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const open = this.open
    if (!open) {
      this.inputTurn(route, utterance)
    } else {
      // A finalized Gemini ASR segment is not necessarily a new human thought.
      // Keep the existing product turn joinable; the transcript that follows
      // supplies the evidence needed to distinguish a continuation from the
      // target-language speaker handing off to a new counterpart.
      this.reengage(open, route)
    }
    this.publish()
  }

  /**
   * Gemini VAD found end of speech.
   *
   * This closes microphone input immediately, but does not freeze a final
   * transcription that is allowed to arrive later because Live transcription is
   * explicitly unordered relative to model output.
   */
  speechEnded(routeId: number, utterance: number): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const current = this.open
    const bound = current?.utteranceByRoute.get(route.id)
    const open =
      current && bound !== undefined && utterance > bound
        ? current
        : this.inputTurn(route, utterance)
    if (!open) return
    this.reengage(open, route)
    open.sourceEnded = true
    this.advance(open, 'translating')
    this.settleInterim()
    this.publish()
    this.releaseHoldIfDecided(open)
  }

  interimTranscription(
    routeId: number,
    utterance: number,
    transcription: TranscriptionLike,
  ): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const current = this.open
    if (
      (current?.sealedUtteranceByRoute.get(routeId) ?? 0) >= utterance
    ) {
      return
    }
    const bound = current?.utteranceByRoute.get(route.id)
    const open =
      current && bound !== undefined && utterance > bound
        ? current
        : this.inputTurn(route, utterance)
    if (!open) return
    this.reengage(open, route)
    const text = transcription.text?.trim() ?? ''
    if (text) {
      open.interimByRoute.set(route.id, {
        text,
        languageCode: this.readLanguage(transcription) ?? 'und',
      })
    }
    this.observeLanguage(open, route, transcription)
    this.settleInterim()
    this.publish()
  }

  sourceTranscription(
    routeId: number,
    utterance: number,
    transcription: TranscriptionLike,
    finished: boolean,
  ): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const current = this.open
    if (
      (current?.sealedUtteranceByRoute.get(routeId) ?? 0) >= utterance
    ) {
      return
    }
    if (current && this.shouldSplitSourceOnlyTurn(current, route, utterance, transcription)) {
      this.closeTurn()
    }
    const open = this.inputTurn(route, utterance)
    if (!open) return
    const text = transcription.text?.trim() ?? ''
    if (text) this.recordSourceSegment(open, route, utterance, transcription)
    this.observeLanguage(open, route, transcription)

    if (finished) {
      open.sealedUtteranceByRoute.set(
        route.id,
        Math.max(open.sealedUtteranceByRoute.get(route.id) ?? 0, utterance),
      )
      open.sourceEnded = true
      this.advance(open, 'translating')
    }
    this.settleInterim()
    for (const candidate of this.routes.values()) {
      this.observeAutoCounterpart(open, candidate)
    }
    this.publish()
    this.releaseHoldIfDecided(open)
  }

  translationTranscription(
    routeId: number,
    generation: number,
    transcription: TranscriptionLike,
  ): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const open = this.outputTurn(route, generation)
    if (!open) return
    const text = transcription.text?.trim() ?? ''
    if (text) this.recordTranslationSegment(open, route, generation, text)
    this.advance(open, 'translating')
    this.observeAutoCounterpart(open, route)
    this.releaseHoldIfDecided(open)
    this.publish()
  }

  /**
   * Offer one chunk of translated audio.
   *
   * The happy path holds nothing: the route the language evidence favours is
   * scheduled the moment its first chunk arrives, so the only delay between
   * Gemini producing speech and the browser playing it is the scheduler's
   * jitter lead.
   */
  audio(routeId: number, generation: number, pcm16: Uint8Array): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const open = this.outputTurn(route, generation)
    if (!open) return
    const before = open.status
    const previousOwner = open.ownerId
    open.audioByRoute.add(route.id)
    this.advance(open, 'translating')
    this.observeAutoCounterpart(open, route)
    this.route(open, route, pcm16)
    if (open.status !== before || open.ownerId !== previousOwner) this.publish()
  }

  /** Decide where one chunk goes: the speakers, the hold buffer, or nowhere. */
  private route(open: OpenTurn, route: RouteState, pcm16: Uint8Array): void {
    if (open.ownerId === route.id) {
      this.schedule(open, pcm16)
      return
    }
    // One translated voice per utterance, decided before anything is queued.
    if (open.ownerId !== null) return

    const direction = this.direction(open)
    // The speaker is already using the language this conversation renders into
    // and there is no second language yet, so audio can only be their own words
    // read back to them.
    if (direction.silent) return

    const contested =
      (direction.ownerId !== null && direction.ownerId !== route.id) ||
      this.isParroting(open, route.id)
    if (contested) {
      this.hold(open, route.id, pcm16)
      return
    }
    this.claim(open, route.id)
    this.schedule(open, pcm16)
  }

  generationComplete(routeId: number, generation: number): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const open = this.outputTurn(route, generation)
    if (!open) return
    open.generated.add(route.id)

    if (open.ownerId === route.id) {
      // The output boundary. `turnComplete` arrives later while the server
      // waits out its own realtime playback estimate; waiting for it would add
      // seconds to every short turn.
      this.output.endAudio()
      return
    }
    // A route that finished without claiming the floor is not going to speak,
    // so audio held on its account need not wait out the full window.
    if (open.ownerId === null && open.heldId !== null && open.heldId !== route.id) {
      this.releaseHold(open)
    }
    this.closeIfSettled()
  }

  interrupted(routeId: number, generation: number): void {
    const route = this.routes.get(routeId)
    const open = this.open
    if (!route || !open) return
    if (generation < (open.generationByRoute.get(routeId) ?? generation)) return
    if (open.heldId === route.id) this.clearHold(open)
    if (open.ownerId !== route.id) return
    // Only the route being heard may drop what is already scheduled. Dropping
    // it stops the sources synchronously, so the speakers are silent from here
    // whatever order the scheduler's own callback arrives in.
    this.output.flushAudio()
    this.speaking = false
    this.speakingTurn = null
    this.closeTurn()
  }

  /**
   * A route has finished with the utterance it was reporting.
   *
   * `turnComplete` is the model's own statement that its response is over, and
   * unlike `generationComplete` it is sent even for a turn that was cut off. It
   * is therefore also an audio-stream boundary, not only a bookkeeping one.
   */
  routeTurnEnd(routeId: number, utterance: number, generation: number): void {
    const route = this.routes.get(routeId)
    if (!route) return
    const open = this.open
    if (!open) return
    const input = open.utteranceByRoute.get(routeId)
    const output = open.generationByRoute.get(routeId)
    // Only a route run explicitly bound to this turn may end it. In particular,
    // a late `turnComplete` from the non-authoritative route of Turn N cannot be
    // counted against Turn N+1 merely because that route never transcribed it.
    if (input === undefined && output === undefined) return
    if (input !== undefined && input !== utterance) return
    if (output !== undefined && output !== generation) return
    route.active = false
    open.sealedUtteranceByRoute.set(
      route.id,
      Math.max(open.sealedUtteranceByRoute.get(route.id) ?? 0, utterance),
    )
    open.ended.add(routeId)
    if (open.ownerId === routeId && !open.audioFinished) this.output.endAudio()
    this.releaseHoldIfDecided(open)
    this.closeIfSettled()
    if (this.open === open) this.publish()
  }

  // --- Route runs -----------------------------------------------------------

  /**
   * Attach microphone evidence to the turn it belongs to.
   *
   * Gemini's utterance id is an API/VAD segment boundary, not a product turn
   * boundary. The real sessions emitted several finalized ids for one sentence,
   * so a higher id joins the turn that is still open. A product turn ends when
   * its translated audio finishes, when a source-only join window expires, or
   * when a target-language source-only turn hands off to a new language.
   */
  private inputTurn(route: RouteState, utterance: number): OpenTurn | null {
    // Already committed: this is a socket finishing an utterance the
    // conversation has moved past.
    if (utterance <= route.committedUtterance) {
      liveTrace('stale', {
        kind: 'utterance',
        route: route.id,
        utterance,
        committed: route.committedUtterance,
      })
      return null
    }

    const open = this.open
    if (open) {
      const bound = open.utteranceByRoute.get(route.id)
      if (bound === undefined || utterance >= bound) {
        open.utteranceByRoute.set(route.id, utterance)
        if (bound !== undefined && utterance > bound) open.sourceEnded = false
        this.reengage(open, route)
        return open
      }
      return null
    }

    const next = this.begin(route)
    next.utteranceByRoute.set(route.id, utterance)
    return next
  }

  /**
   * Auto's untranslated target-language opener and the first non-target reply
   * are two different human turns even if the reply arrives inside the join
   * window. This is the only pre-playback handoff we can identify without a
   * timer: the language changes from the configured target to another language.
   */
  private shouldSplitSourceOnlyTurn(
    open: OpenTurn,
    route: RouteState,
    utterance: number,
    transcription: TranscriptionLike,
  ): boolean {
    if (
      !this.autoDetect ||
      open.ownerId !== null ||
      open.audioScheduled ||
      open.translationByRoute.size > 0 ||
      open.sourceSegments.has(segmentKey(route.id, utterance))
    ) {
      return false
    }
    const previous = this.reportedLanguage(open)
    const next = this.readLanguage(transcription)
    return Boolean(
      previous &&
        next &&
        languageCodesMatch(previous, this.targetLanguage) &&
        !languageCodesMatch(next, this.targetLanguage),
    )
  }

  private recordSourceSegment(
    open: OpenTurn,
    route: RouteState,
    utterance: number,
    transcription: TranscriptionLike,
  ): void {
    const key = segmentKey(route.id, utterance)
    const previous = open.sourceSegments.get(key)
    open.sourceSegments.set(key, {
      key,
      routeId: route.id,
      utterance,
      text: transcription.text?.trim() ?? '',
      language: this.readLanguage(transcription),
      observed: previous?.observed ?? false,
    })
    open.sourceByRoute.set(
      route.id,
      joinSegments(
        [...open.sourceSegments.values()]
          .filter((segment) => segment.routeId === route.id)
          .map((segment) => segment.text),
      ),
    )
  }

  private recordTranslationSegment(
    open: OpenTurn,
    route: RouteState,
    generation: number,
    text: string,
  ): void {
    open.translationSegments.set(segmentKey(route.id, generation), {
      routeId: route.id,
      text,
    })
    open.translationByRoute.set(
      route.id,
      joinSegments(
        [...open.translationSegments.values()]
          .filter((segment) => segment.routeId === route.id)
          .map((segment) => segment.text),
      ),
    )
  }

  /**
   * Attach generated output to the turn it belongs to.
   *
   * Output without an utterance to answer is residue from a turn that has
   * already been committed, and output from an earlier response than the one
   * this turn adopted cannot change it.
   *
   * Deliberately not allowed to open a turn. A turn is something a *person*
   * said, and every route now reports the people it hears, so there is always
   * an opener; letting model output open one instead meant a socket catching up
   * on a committed turn wrote a row of its own — a translation with nobody
   * having said anything, appearing after the conversation had moved on.
   */
  private outputTurn(route: RouteState, generation: number): OpenTurn | null {
    if (generation <= route.committedGeneration) {
      liveTrace('stale', {
        kind: 'generation',
        route: route.id,
        generation,
        committed: route.committedGeneration,
      })
      return null
    }
    const open = this.open
    if (!open) {
      liveTrace('stale', { kind: 'no-open-turn', route: route.id, generation })
      return null
    }
    const bound = open.generationByRoute.get(route.id)
    if (bound !== undefined && generation < bound) return null
    open.generationByRoute.set(route.id, generation)
    this.reengage(open, route)
    return open
  }

  // --- Playback -------------------------------------------------------------

  playbackStarted(): void {
    this.speaking = true
    // `speakingTurn` is set when audio is handed to the scheduler, not here:
    // a turn whose first chunk joined a stream that was already running would
    // otherwise never be recognised as the one being spoken, and could never
    // be told that its audio had finished.
    if (this.speakingTurn === null) this.speakingTurn = this.open?.id ?? null
    const open = this.open
    if (open && open.id === this.speakingTurn) this.advance(open, 'playing')
    this.publish()
  }

  /**
   * Translated speech has physically finished.
   *
   * This is the normal end of a turn, and it is deterministic: the scheduler
   * reports it off the audio clock once the last chunk it was given has played.
   * Nothing on this path is a watchdog.
   */
  playbackEnded(): void {
    const finished = this.speakingTurn
    this.speaking = false
    this.speakingTurn = null
    const open = this.open
    // The turn whose translation was being spoken is over. A turn that opened
    // while the previous one was still audible is not.
    if (open && open.id === finished) {
      open.audioFinished = true
      if (open.ownerId !== null) {
        this.closeTurn()
        return
      }
    }
    this.publish()
    this.closeIfSettled()
  }

  /**
   * Somebody started talking over the translation.
   *
   * Human speech outranks synthesized speech, so the rest of the playback is
   * abandoned and the turn it belonged to is committed exactly as it stands.
   * Nothing about that turn is rewritten: its source and its translation are
   * already what the two people saw, and only the audio nobody wanted to hear
   * the end of is cancelled. Everything the abandoned turn's sockets still send
   * is dropped by id, so it cannot reach the person who interrupted.
   */
  bargeIn(): void {
    // Read before flushing: dropping the queue reports playback as ended, and
    // that is where a turn the speakers had finished with is committed.
    const spoken = this.speakingTurn
    if (!this.speaking && !this.open) return
    liveTrace('barge-in-commit', { turn: spoken, wasSpeaking: this.speaking })
    this.output.flushAudio()
    this.speaking = false
    this.speakingTurn = null
    // Only the turn the speakers were working through is committed. A turn that
    // opened after them belongs to the person interrupting — closing that one
    // would throw away the very words that caused this.
    if (this.open && this.open.id === spoken) this.closeTurn()
    this.publish()
  }

  // --- Turn lifecycle -------------------------------------------------------

  private begin(route: RouteState): OpenTurn {
    const existing = this.open
    if (existing) {
      this.reengage(existing, route)
      return existing
    }
    route.active = true

    this.turnCounter += 1
    const open: OpenTurn = {
      id: `turn-${this.turnCounter}`,
      createdAt: Date.now(),
      status: 'speaking',
      utteranceByRoute: new Map(),
      generationByRoute: new Map(),
      sourceByRoute: new Map(),
      translationByRoute: new Map(),
      sourceSegments: new Map(),
      translationSegments: new Map(),
      languageByRoute: new Map(),
      interimByRoute: new Map(),
      sealedUtteranceByRoute: new Map(),
      sourceEnded: false,
      ownerId: null,
      audioScheduled: false,
      audioFinished: false,
      heldId: null,
      held: [],
      heldBytes: 0,
      holdTimer: null,
      audioByRoute: new Set(),
      generated: new Set(),
      ended: new Set(),
      settleTimer: null,
    }
    this.open = open
    liveTrace('turn-open', { turn: open.id, by: route.id })
    return open
  }

  /** This route has more to say about the utterance after all. */
  private reengage(open: OpenTurn, route: RouteState): void {
    route.active = true
    open.ended.delete(route.id)
    this.cancelSettleTimer(open)
  }

  private advance(open: OpenTurn, status: TurnStatus): void {
    if (STATUS_ORDER[status] > STATUS_ORDER[open.status]) open.status = status
  }

  /**
   * Finish the open turn and let the next speaker be heard.
   *
   * The route runs this turn was made of are recorded as committed, so anything
   * a socket still has to say about them is dropped by id rather than by being
   * compared to the row that was just written. Once this returns, the turn is
   * in history and nothing can change it.
   */
  private closeTurn(): void {
    const open = this.open
    if (!open) return
    this.clearHold(open)
    this.cancelSettleTimer(open)
    open.status = 'complete'
    const turn = this.render(open)
    // A turn is something a person said, so what they said is what makes it
    // one. A translation with no source behind it is residue — the socket
    // catching up on a response, or a bookkeeping message that opened a turn of
    // its own — and putting it on screen is how a conversation fills with rows
    // nobody spoke. A turn with source and no translation is kept: that is the
    // ordinary shape of somebody speaking the language the session renders into.
    if (turn.sourceText) {
      this.history = [...this.history, turn]
    }
    for (const route of this.routes.values()) {
      const utterance = open.utteranceByRoute.get(route.id)
      if (utterance !== undefined) {
        route.committedUtterance = Math.max(route.committedUtterance, utterance)
      }
      const generation = open.generationByRoute.get(route.id)
      if (generation !== undefined) {
        route.committedGeneration = Math.max(
          route.committedGeneration,
          generation,
        )
      }
      route.active = false
    }
    // Deliberately not clearing `speakingTurn`: which turn the speakers are
    // working through is a fact about the audio device, and it stays true after
    // the turn is committed. Forgetting it here meant the next turn's first
    // chunk did not recognise that it was taking the speakers over, and the
    // previous translation carried on talking underneath the new one.
    this.open = null
    this.interim = null
    liveTrace('turn-close', {
      turn: turn.id,
      owner: open.ownerId,
      kept: Boolean(turn.sourceText || turn.translatedText),
      language: turn.sourceLanguage,
      into: turn.targetLanguage,
      sourcePresent: turn.sourceText.length > 0,
      interpreted: this.interpretation(open)?.id ?? null,
      reported: this.reportedLanguage(open),
      counterpart: this.counterpart,
      pair: `${this.counterpart ?? 'auto'}<->${this.targetLanguage}`,
    })
    this.publish()
  }

  /**
   * Close the turn once nothing is still speaking, playing, or pending.
   *
   * A turn with no audio is over when every route has said its piece, not when
   * the first of them happens to go quiet: the two sockets describe the same
   * utterance a few milliseconds apart, and committing on the earlier one is
   * what let the later one open a second turn for the same sentence.
   */
  private closeIfSettled(): void {
    const open = this.open
    if (!open) return
    // A claimed turn ends when its audio has physically finished, not when the
    // sockets go quiet — but only while that audio is genuinely still the thing
    // the speakers are working through. Waiting on a stream that was flushed,
    // superseded or never announced is waiting forever, and the microphone is
    // closed for exactly that long.
    if (open.audioScheduled && !open.audioFinished) {
      if (this.speakingTurn === open.id) return
      open.audioFinished = true
    }
    if (open.heldId !== null) return
    for (const route of this.routes.values()) {
      const participates =
        open.utteranceByRoute.has(route.id) ||
        open.generationByRoute.has(route.id)
      if (participates && route.active) return
    }

    // The evidence route can report a few milliseconds after the source route.
    // Give it one bounded chance to bind before committing a source-only turn;
    // otherwise its reverse-direction translation would arrive to no turn at
    // all. The hard microphone gate prevents a new human utterance entering
    // during this window.
    for (const route of this.routes.values()) {
      const participates =
        open.utteranceByRoute.has(route.id) ||
        open.generationByRoute.has(route.id)
      if (!participates) {
        this.armSettleTimer(open)
        return
      }
    }

    for (const route of this.routes.values()) {
      const participates =
        open.utteranceByRoute.has(route.id) ||
        open.generationByRoute.has(route.id)
      if (participates && !open.ended.has(route.id)) {
        this.armSettleTimer(open)
        return
      }
    }
    // A route being done with one server turn does not prove the person was
    // done with their thought. Keep source-only/text-only turns joinable across
    // the finalized sub-sentence segments seen in the browser traces.
    this.armSettleTimer(open)
  }

  private armSettleTimer(open: OpenTurn): void {
    if (open.settleTimer !== null) return
    open.settleTimer = setTimeout(() => {
      open.settleTimer = null
      if (this.open === open) this.closeTurn()
    }, SILENT_TURN_SETTLE_MS)
  }

  private cancelSettleTimer(open: OpenTurn): void {
    if (open.settleTimer !== null) {
      clearTimeout(open.settleTimer)
      open.settleTimer = null
    }
  }

  /** Abandon the turn in progress without committing it. */
  private discardOpenTurn(): void {
    const open = this.open
    if (open) {
      this.clearHold(open)
      this.cancelSettleTimer(open)
    }
    this.open = null
    this.interim = null
    this.speaking = false
    this.speakingTurn = null
    for (const route of this.routes.values()) route.active = false
  }

  // --- Direction ------------------------------------------------------------

  /**
   * Which route this utterance belongs to, from the language being spoken.
   *
   * The two routes report the language independently. Agreement is treated as
   * knowledge; disagreement is treated as ignorance, because a route that has
   * mis-identified the speech is exactly the route that is about to read it
   * back, and its own metadata says so no more loudly than the other route's.
   */
  private direction(open: OpenTurn): {
    ownerId: number | null
    target: SupportedLanguageCode | null
    silent: boolean
  } {
    // Deliberately the reported language, not the pair-side inference: that
    // one reads ownership, and this is what decides ownership.
    const language = this.reportedLanguage(open)
    if (!language) return { ownerId: null, target: null, silent: false }

    if (languageCodesMatch(language, this.targetLanguage)) {
      // The speaker is on the "translate into" side, so they are interpreted
      // back towards the other person's language.
      if (!this.counterpart) return { ownerId: null, target: null, silent: true }
      return {
        ownerId: this.routeTargeting(this.counterpart),
        target: this.counterpart,
        silent: false,
      }
    }

    // Auto always renders a currently non-target utterance into the configured
    // target. The counterpart is revisable state used for the return direction,
    // not a whitelist that can make later Spanish speech look Vietnamese.
    if (this.autoDetect) {
      return {
        ownerId: this.routeTargeting(this.targetLanguage),
        target: this.targetLanguage,
        silent: false,
      }
    }

    if (this.counterpart && languageCodesMatch(language, this.counterpart)) {
      return {
        ownerId: this.routeTargeting(this.targetLanguage),
        target: this.targetLanguage,
        silent: false,
      }
    }

    // A language the explicit pair does not carry. Let actual interpretation
    // evidence arbitrate it instead of inventing a third configured side.
    return { ownerId: null, target: null, silent: false }
  }

  /**
   * The strongest language evidence across every finalized ASR segment in this
   * product turn.
   *
   * No socket is a permanent authority. Trace 3 showed the fixed English-target
   * route returning Bengali-looking source text for English speech while the
   * route that actually interpreted it had coherent English. Weighting the
   * independently reported segments keeps one late metadata wobble from
   * overwriting the accumulated utterance, while script contradictions are
   * still rejected outright.
   */
  private reportedLanguage(open: OpenTurn): SupportedLanguageCode | null {
    const scores = new Map<SupportedLanguageCode, number>()
    for (const segment of open.sourceSegments.values()) {
      const language = segment.language
      if (!language || !scriptSupportsLanguage(language, segment.text)) continue
      const matching = [...scores.keys()].find((candidate) =>
        languageCodesMatch(candidate, language),
      )
      const key = matching ?? language
      scores.set(key, (scores.get(key) ?? 0) + Math.max(1, evidenceScore(segment.text)))
    }

    // Interim-only and synthetic tests may not have a finalized segment map.
    if (scores.size === 0) {
      for (const [routeId, language] of open.languageByRoute) {
        const text = open.sourceByRoute.get(routeId) ?? ''
        if (text && !scriptSupportsLanguage(language, text)) continue
        scores.set(language, (scores.get(language) ?? 0) + Math.max(1, evidenceScore(text)))
      }
    }

    const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1])
    if (ranked.length === 0) return null
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null
    return ranked[0][0]
  }

  /** Whether some route actually interpreted this utterance. */
  private interpretation(open: OpenTurn): RouteState | null {
    for (const routeId of open.translationByRoute.keys()) {
      if (this.isParroting(open, routeId)) continue
      const route = this.routes.get(routeId)
      if (route) return route
    }
    return null
  }

  /**
   * Whether every route has finished with this utterance without interpreting
   * it.
   *
   * `echoTargetLanguage: false` makes a route silent when the language being
   * spoken is already its target, so routes that all stayed quiet have told us
   * what the speech was — more reliably than the language code did.
   */
  private settledSilent(open: OpenTurn): boolean {
    if (this.interpretation(open)) return false
    return open.generated.size > 0 || open.ended.size > 0
  }

  /**
   * Which side of the conversation spoke.
   *
   * Once a pair exists there is no third speaker, only a mis-identification, so
   * a third language is resolved to a side of the pair rather than shown. The
   * route that interpreted names the side directly: it renders *into* the other
   * language, so the speaker used the one it is not.
   */
  private spokenLanguage(open: OpenTurn): SupportedLanguageCode | null {
    const reported = this.reportedLanguage(open)
    const counterpart = this.counterpart

    if (this.autoDetect) {
      // A route that stayed silent decided the speech was already its target.
      if (this.settledSilent(open) && !this.interpretation(open)) {
        return this.targetLanguage
      }
      // Auto follows current utterance evidence even when it disagrees with a
      // previously adopted counterpart. That disagreement is how recovery and
      // genuine language changes become possible.
      if (reported) {
        if (languageCodesMatch(reported, this.targetLanguage)) {
          return this.targetLanguage
        }
        const source = longest(open.sourceByRoute.values())
        if (
          (source && textHasScriptEvidence(source)) ||
          this.interpretation(open) ||
          open.ownerId !== null
        ) {
          return reported
        }
        return null
      }
      const voice = this.voiceRoute(open)
      if (!voice) return null
      return languageCodesMatch(voice.target, this.targetLanguage)
        ? counterpart
        : this.targetLanguage
    }

    if (counterpart) {
      // A voice names the side directly, and it is the strongest evidence there
      // is: a route renders *into* one language, so the person used the other.
      // Deriving the side this way rather than reading a metadata code is also
      // what makes an impossible turn impossible — the source side is computed
      // as the opposite of the target, so the two can never come out equal. A
      // real session closed ten turns as Spanish interpreted into Spanish
      // because the code was trusted here and the owner was not consulted.
      const voice = this.voiceRoute(open)
      if (voice) {
        return languageCodesMatch(voice.target, this.targetLanguage)
          ? counterpart
          : this.targetLanguage
      }
      // Nobody interpreted, so there is no direction to read off. The pair is
      // still only two sides, and a code naming one of them is now the best
      // evidence available.
      if (
        reported &&
        (languageCodesMatch(reported, this.targetLanguage) ||
          languageCodesMatch(reported, counterpart))
      ) {
        return reported
      }
      return this.settledSilent(open) ? this.targetLanguage : null
    }

    return null
  }

  /**
   * What the person said, chosen between two transcriptions of one utterance.
   *
   * Both routes transcribe the same audio, and they can disagree about writing
   * system: one returns the language's own script and the other a Latin
   * transliteration of it. Where the language is known and written in its own
   * script, that reading is the source; otherwise the fuller one is. Nothing is
   * transliterated or invented here — if every route returned Latin text, Latin
   * text is what the API produced.
   */
  private sourceText(open: OpenTurn): string {
    const candidates = [...open.sourceByRoute.values()].filter(Boolean)
    if (candidates.length < 2) return candidates[0] ?? ''

    const language = this.spokenLanguage(open)
    const voice = this.voiceRoute(open)
    const interpreted = voice ? (open.sourceByRoute.get(voice.id) ?? '') : ''
    if (language) {
      const native = candidates.filter(
        (text) =>
          textHasScriptEvidence(text) && scriptSupportsLanguage(language, text),
      )
      if (native.length > 0) {
        return interpreted && native.includes(interpreted)
          ? interpreted
          : longest(native)
      }
    }
    // The route whose output belongs to the utterance is also the coherent
    // source view for it. This prevents a losing route's target-language
    // rendering from being displayed as what the human said.
    return interpreted || longest(candidates)
  }

  private ownerRoute(open: OpenTurn): RouteState | null {
    return open.ownerId === null
      ? null
      : (this.routes.get(open.ownerId) ?? null)
  }

  /**
   * The one route that speaks for this turn.
   *
   * Whoever actually owns the speakers, else whoever the language says should,
   * else whoever demonstrably interpreted. `spokenLanguage` and `render` both
   * read it, and they must read the same one: when the side was taken from the
   * route that interpreted and the target from the route that owned the audio,
   * a turn could close as its own source language.
   */
  private voiceRoute(open: OpenTurn): RouteState | null {
    const owner = this.ownerRoute(open)
    if (owner) return owner
    const favoured = this.direction(open).ownerId
    if (favoured !== null) {
      const route = this.routes.get(favoured)
      if (route) return route
    }
    return this.interpretation(open)
  }

  private routeTargeting(language: SupportedLanguageCode): number | null {
    for (const route of this.routes.values()) {
      if (languageCodesMatch(route.target, language)) return route.id
    }
    return null
  }

  /**
   * Feed Auto only language evidence that the primary route actually acted on.
   * Each finalized ASR segment contributes once, however many transcript/audio
   * packets its response contains.
   */
  private observeAutoCounterpart(open: OpenTurn, route: RouteState): void {
    if (!this.autoDetect || !languageCodesMatch(route.target, this.targetLanguage)) {
      return
    }
    const translation = open.translationByRoute.get(route.id) ?? ''
    const acted =
      open.audioByRoute.has(route.id) ||
      Boolean(translation && !this.isParroting(open, route.id))
    if (!acted) return

    for (const segment of open.sourceSegments.values()) {
      if (segment.routeId !== route.id || segment.observed) continue
      segment.observed = true
      const language = segment.language
      if (!language || languageCodesMatch(language, this.targetLanguage)) continue
      this.updateAutoCounterpart(language, segment.text)
    }
  }

  private updateAutoCounterpart(
    language: SupportedLanguageCode,
    text: string,
  ): void {
    if (this.counterpart && languageCodesMatch(this.counterpart, language)) {
      this.autoCandidate = null
      return
    }

    if (
      !this.autoCandidate ||
      !languageCodesMatch(this.autoCandidate.language, language)
    ) {
      this.autoCandidate = { language, score: 0, observations: 0 }
    }
    const candidate = this.autoCandidate
    candidate.score += Math.max(1, evidenceScore(text))
    candidate.observations += 1

    const scriptEvidence =
      textHasScriptEvidence(text) && scriptSupportsLanguage(language, text)
    const enough = this.counterpart
      ? scriptEvidence ||
        candidate.score >= AUTO_SWITCH_EVIDENCE_SCORE ||
        (candidate.observations >= 2 &&
          candidate.score >= AUTO_REPEATED_EVIDENCE_SCORE)
      : scriptEvidence || candidate.score >= AUTO_INITIAL_EVIDENCE_SCORE
    if (!enough) return

    const previous = this.counterpart
    this.counterpart = candidate.language
    this.autoCandidate = null
    liveTrace('counterpart', {
      from: previous,
      to: this.counterpart,
      observations: candidate.observations,
      score: candidate.score,
    })
    this.output.counterpartDetected(this.counterpart)
  }

  // --- Audio ownership ------------------------------------------------------

  private claim(open: OpenTurn, routeId: number): void {
    open.ownerId = routeId
    liveTrace('claim', {
      turn: open.id,
      route: routeId,
      favoured: this.direction(open).ownerId,
      language: this.reportedLanguage(open),
      counterpart: this.counterpart,
      into: this.targetLanguage,
    })
    if (open.heldId !== null && open.heldId !== routeId) this.clearHold(open)
    // A route can finish generating while its audio is still being held. The
    // stream boundary is announced now rather than left to the scheduler's
    // idle fallback, which would add a second to the end of the turn.
    if (open.generated.has(routeId)) this.output.endAudio()
  }

  /**
   * Hand one chunk to the speakers on behalf of `open`.
   *
   * Whoever schedules audio owns the speakers from that moment, and a turn
   * taking them over from an older one abandons what is left of the older
   * stream. Two turns' translations must never overlap, and the previous turn
   * is over by definition — a new one only exists because somebody spoke again.
   */
  private schedule(open: OpenTurn, pcm16: Uint8Array): void {
    if (this.speakingTurn !== null && this.speakingTurn !== open.id) {
      this.output.flushAudio()
      this.speaking = false
      this.speakingTurn = null
    }
    if (!this.output.playAudio(pcm16)) return
    open.audioScheduled = true
    this.speakingTurn = open.id
  }

  private hold(open: OpenTurn, routeId: number, pcm16: Uint8Array): void {
    if (open.heldId !== routeId) {
      open.held = []
      open.heldBytes = 0
      open.heldId = routeId
    }
    open.held.push(pcm16)
    open.heldBytes += pcm16.byteLength
    while (open.heldBytes > MAX_HELD_AUDIO_BYTES && open.held.length > 1) {
      open.heldBytes -= open.held.shift()?.byteLength ?? 0
    }
  }

  /**
   * Let held audio through, unless it is the speaker's own words.
   *
   * By this point the route has usually produced enough translated text to tell
   * the two apart, which is the check the language metadata could not make.
   */
  private releaseHold(open: OpenTurn): void {
    const routeId = open.heldId
    if (routeId === null || open.ownerId !== null) {
      this.clearHold(open)
      return
    }
    // A clock is not language evidence. If the configured pair favours another
    // route, wait until that route either speaks or explicitly finishes silent.
    // Trace 5's correct Spanish output arrived only 26 ms after the old 250 ms
    // timer handed the turn to English readback.
    const favoured = this.direction(open).ownerId
    const favouredIsSpeaking =
      favoured !== null &&
      favoured !== routeId &&
      open.audioByRoute.has(favoured)
    const favouredSettled =
      favoured !== null &&
      favoured !== routeId &&
      (open.generated.has(favoured) || open.ended.has(favoured))
    if (favouredIsSpeaking || this.isParroting(open, routeId)) {
      liveTrace('hold-drop', {
        turn: open.id,
        route: routeId,
        favoured,
        reason: favouredIsSpeaking ? 'favoured-speaking' : 'readback',
      })
      this.clearHold(open)
      this.closeIfSettled()
      return
    }
    if (favoured !== null && favoured !== routeId && !favouredSettled) return

    if (favoured === null) {
      const interpretations = [...open.translationByRoute.keys()].filter(
        (candidate) => !this.isParroting(open, candidate),
      )
      const otherRoutesSettled = [...this.routes.keys()].every(
        (candidate) =>
          candidate === routeId ||
          open.generated.has(candidate) ||
          open.ended.has(candidate),
      )
      if (
        interpretations.length !== 1 ||
        interpretations[0] !== routeId ||
        !otherRoutesSettled
      ) {
        return
      }
    }
    const held = open.held
    open.held = []
    open.heldBytes = 0
    this.cancelHoldTimer(open)
    open.heldId = null
    this.claim(open, routeId)
    for (const chunk of held) this.schedule(open, chunk)
    this.publish()
  }

  /** Release once route evidence, rather than elapsed time, has decided. */
  private releaseHoldIfDecided(open: OpenTurn): void {
    if (open.heldId === null || open.ownerId !== null) return
    const direction = this.direction(open)
    if (direction.silent) {
      this.clearHold(open)
      this.closeIfSettled()
      return
    }
    if (direction.ownerId === open.heldId) {
      this.releaseHold(open)
      return
    }
    if (direction.ownerId === null) this.releaseHold(open)
  }

  private clearHold(open: OpenTurn): void {
    this.cancelHoldTimer(open)
    open.heldId = null
    open.held = []
    open.heldBytes = 0
  }

  private cancelHoldTimer(open: OpenTurn): void {
    if (open.holdTimer !== null) {
      clearTimeout(open.holdTimer)
      open.holdTimer = null
    }
  }

  /**
   * Whether a route has handed the speaker their own words back.
   *
   * Compared against whatever was heard of the utterance, not only against this
   * route's own transcription: a route that reports no input of its own is
   * still parroting if what it generated is what the other route heard.
   */
  private isParroting(open: OpenTurn, routeId: number): boolean {
    const translation = open.translationByRoute.get(routeId) ?? ''
    if (!translation) return false
    const source =
      open.sourceByRoute.get(routeId) || longest(open.sourceByRoute.values())
    return Boolean(source && isNearDuplicateTranscript(source, translation))
  }

  // --- Evidence plumbing ----------------------------------------------------

  private observeLanguage(
    open: OpenTurn,
    route: RouteState,
    transcription: TranscriptionLike,
  ): void {
    const language = this.readLanguage(transcription)
    if (language) open.languageByRoute.set(route.id, language)
  }

  private readLanguage(
    transcription: TranscriptionLike,
  ): SupportedLanguageCode | null {
    return resolveTranscriptLanguage(
      transcription.languageCode,
      transcription.text ?? '',
    )
  }

  /**
   * The live caption is a preview of a turn that has no text yet. Once the API
   * has transcribed the utterance the turn itself shows it, so the caption goes
   * away rather than repeating the row below it.
   */
  private settleInterim(): void {
    const open = this.open
    if (!open || open.sourceByRoute.size > 0 || open.interimByRoute.size === 0) {
      this.interim = null
      return
    }
    let best: InterimTranscript | null = null
    for (const candidate of open.interimByRoute.values()) {
      if (!best || candidate.text.length > best.text.length) best = candidate
    }
    this.interim = best
  }

  // --- Publishing -----------------------------------------------------------

  /**
   * The turn as the product sees it.
   *
   * Source text is whichever route heard the most of it; both are transcribing
   * the same speech. Translated text comes only from the route that owns the
   * utterance, so the other route's output — which is either nothing or a
   * readback — can never be attached to somebody's words.
   */
  private render(open: OpenTurn): ConversationTurn {
    const direction = this.direction(open)
    const voiceId = open.ownerId ?? direction.ownerId
    const translatedText =
      voiceId === null ? '' : (open.translationByRoute.get(voiceId) ?? '')
    const voiceTarget =
      voiceId === null
        ? direction.target
        : (this.routes.get(voiceId)?.target ?? direction.target)
    const sourceLanguage = this.spokenLanguage(open)
    // The pair has two sides and a turn is interpreted into the one that was
    // not spoken. Derived rather than read off a route, so that a row can never
    // claim to translate a language into itself.
    const targetLanguage =
      this.counterpart && sourceLanguage
        ? languageCodesMatch(sourceLanguage, this.targetLanguage)
          ? this.counterpart
          : this.targetLanguage
        : voiceTarget

    return {
      id: open.id,
      sourceLanguage,
      sourceText: this.sourceText(open),
      targetLanguage: voiceId === null ? null : targetLanguage,
      translatedText,
      status: open.status,
      createdAt: open.createdAt,
    }
  }

  private publish(): void {
    this.view = this.open
      ? [...this.history, this.render(this.open)]
      : this.history
    this.output.changed()
  }
}
