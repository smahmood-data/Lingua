import { GoogleGenAI, Modality } from '@google/genai'
import type { LiveServerMessage, Session, Transcription } from '@google/genai'
import {
  CONNECT_TIMEOUT_MS,
  END_OF_SPEECH_SENSITIVITY,
  END_OF_SPEECH_SILENCE_MS,
  INPUT_AUDIO_MIME_TYPE,
  LIVE_API_VERSION,
  TRANSCRIPT_IDLE_FINALIZE_MS,
} from './config'
import { sessionError } from './errors'
import { resolveTranscriptLanguage } from '../../types'
import type { SupportedLanguageCode } from './types'
import { base64ToBytes } from './audio/pcm'

/**
 * One Live Translate route.
 *
 * A route is a socket with a single `targetLanguageCode`: the API has no
 * source-language field, so a route can only ever be described as "everything
 * heard, rendered into this one language". Deciding which route a given
 * utterance belongs to needs both routes' evidence side by side, so it is not
 * decided here — this module only normalises the wire protocol into the events
 * below and leaves every judgement to `ConversationCoordinator`.
 */
/**
 * Which run of events an event belongs to.
 *
 * `utterance` counts finalized input runs from one route and `generation`
 * counts model responses. A finalized input run can be only a sub-sentence ASR
 * segment; `ConversationCoordinator` groups those transport ids into the human
 * conversational turn. The ids still matter because late events must not land
 * on a later product turn.
 */
export interface LiveTransportEvents {
  /** Gemini started a new input run (not necessarily a whole human thought). */
  onSpeechStart: (utterance: number) => void
  /** Gemini's VAD says that human utterance has ended. */
  onSpeechEnd: (utterance: number) => void
  /** Translated audio, as little-endian PCM16 at `OUTPUT_SAMPLE_RATE`. */
  onAudio: (pcm16: Uint8Array, generation: number) => void
  /**
   * Everything transcribed of the current utterance, on every update.
   *
   * `finished` ends this transcription segment. The browser traces demonstrate
   * that several such segments can belong to one human sentence, so it is not
   * promoted to a product turn boundary here.
   */
  onSourceTranscript: (
    transcription: Transcription,
    finished: boolean,
    utterance: number,
  ) => void
  /** Everything this route has generated for that speech so far. */
  onTranslationTranscript: (
    transcription: Transcription,
    generation: number,
  ) => void
  /** Speculative partial transcription of the speaker, updated while talking. */
  onInterimTranscript: (transcription: Transcription, utterance: number) => void
  /** The model's current output was cut off; queued playback is stale. */
  onInterrupted: (generation: number) => void
  /** The model has produced the last audio chunk for this response. */
  onGenerationComplete: (generation: number) => void
  /** This route is finished with the utterance it was working on. */
  onTurnEnd: (utterance: number, generation: number) => void
  /** The socket closed. `expected` is false for a drop we did not initiate. */
  onClosed: (expected: boolean) => void
  /** A transport-level error, ahead of the close event. */
  onError: () => void
}

export interface LiveTransportOptions {
  /** Short-lived ephemeral token from the server. Never the long-lived key. */
  token: string
  model: string
  /** The one language this route renders everything it hears into. */
  targetLanguage: SupportedLanguageCode
  /** Server-returned instruction that matches this token's constraints. */
  systemInstruction: string
  /** Cancels a connection attempt that has not completed setup yet. */
  signal: AbortSignal
  events: LiveTransportEvents
}

export interface LiveTransport {
  sendAudioChunk: (base64Pcm16: string) => void
  close: () => void
}

/**
 * The SDK does not currently accept an AbortSignal for Live connections and
 * does not expose its Session until setup completes. Capture the browser socket
 * it creates synchronously so cancellation can close a pending handshake too.
 *
 * The constructor replacement exists only for the synchronous connect() call
 * and is restored before control returns to the event loop.
 */
function connectWithSocketCapture<T>(
  connect: () => Promise<T>,
  onSocket: (socket: WebSocket) => void,
): Promise<T> {
  const NativeWebSocket = globalThis.WebSocket
  if (typeof NativeWebSocket !== 'function') {
    return connect()
  }

  const TrackingWebSocket = new Proxy(NativeWebSocket, {
    construct(target, argumentsList) {
      const socket = Reflect.construct(target, argumentsList, target) as WebSocket
      onSocket(socket)
      return socket
    },
  })

  let installed = false
  try {
    globalThis.WebSocket = TrackingWebSocket as typeof WebSocket
    installed = globalThis.WebSocket === TrackingWebSocket
    return connect()
  } finally {
    if (installed) {
      globalThis.WebSocket = NativeWebSocket
    }
  }
}

function readAudioParts(message: LiveServerMessage): Uint8Array[] {
  const parts = message.serverContent?.modelTurn?.parts ?? []
  const chunks: Uint8Array[] = []

  for (const part of parts) {
    const inlineData = part.inlineData
    if (!inlineData?.data || !inlineData.mimeType?.startsWith('audio/')) {
      continue
    }
    try {
      chunks.push(base64ToBytes(inlineData.data))
    } catch {
      // atob throws on malformed base64. Skip the chunk rather than aborting
      // the whole message, which would also drop its transcription fields.
    }
  }

  return chunks
}

function mergeTranscriptionText(current: string, incoming: string): string {
  const next = incoming.trim()
  if (!next) return current
  if (!current) return next
  if (next.startsWith(current)) return next
  if (current.endsWith(next)) return current

  const overlapLimit = Math.min(current.length, next.length)
  for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
    if (current.endsWith(next.slice(0, overlap))) {
      return current + next.slice(overlap)
    }
  }

  const needsSpace =
    !/\s$/u.test(current) &&
    !/^[\s,.;:!?،。！？]/u.test(next) &&
    !/[\u3040-\u30ff\u3400-\u9fff]$/u.test(current) &&
    !/^[\u3040-\u30ff\u3400-\u9fff]/u.test(next)
  return `${current}${needsSpace ? ' ' : ''}${next}`
}

/**
 * Whether a transcription carries any of what a person said.
 *
 * Live sends contentless `inputTranscription` and `outputTranscription`
 * messages as bookkeeping — a boundary marker with `finished` set and no text.
 * Treating one as a human utterance is what produced 33 zero-length source
 * transcripts and 21 ghost turns in 44 seconds of a real session: each one
 * advanced the utterance counter, ended the turn actually in progress, opened a
 * new one, and re-labelled the response still streaming so it was charged to
 * the ghost.
 */
function hasSpeech(transcription: Transcription | undefined): boolean {
  return Boolean(transcription?.text?.trim())
}

function mergeTranscription(
  current: Transcription | null,
  incoming: Transcription,
): Transcription {
  const text = mergeTranscriptionText(current?.text ?? '', incoming.text ?? '')
  const languageCode =
    resolveTranscriptLanguage(
      incoming.languageCode ?? current?.languageCode,
      text,
    ) ?? incoming.languageCode ?? current?.languageCode

  return { ...current, ...incoming, text, languageCode }
}

/**
 * A single rearmable timeout. Arming replaces any pending run, so the caller
 * below can extend the idle window without tracking handles itself.
 */
function createRearmableTimer() {
  let handle: ReturnType<typeof setTimeout> | null = null
  return {
    arm(delayMs: number, run: () => void) {
      if (handle !== null) clearTimeout(handle)
      handle = setTimeout(() => {
        handle = null
        run()
      }, delayMs)
    },
    cancel() {
      if (handle !== null) {
        clearTimeout(handle)
        handle = null
      }
    },
  }
}

/**
 * Connect to Gemini Live Translate and normalise its messages into the small
 * event set the session controller needs.
 *
 * The browser authenticates with the ephemeral token only.
 *
 * `client.live.connect()` awaits the socket opening and then the `setupComplete`
 * message, and neither wait is rejected when the socket errors or closes first.
 * Left alone it stays pending forever, so the failure callbacks and a timeout
 * settle it here instead; otherwise a failed start would never return.
 */
export async function connectLiveTransport(
  options: LiveTransportOptions,
): Promise<LiveTransport> {
  if (options.signal.aborted) {
    throw sessionError('live-connection-failed')
  }

  const client = new GoogleGenAI({
    apiKey: options.token,
    httpOptions: { apiVersion: LIVE_API_VERSION },
  })

  let connected = false
  let abandoned = false
  let closedByClient = false
  let pendingSocket: WebSocket | null = null
  let sourceTranscript: Transcription | null = null
  let translationTranscript: Transcription | null = null
  /** Whether anything has been reported about the utterance in progress. */
  let turnOpen = false
  /** Monotonic id of the finalized input run this route is reporting. */
  let utterance = 0
  /** Monotonic id of the model response this route is producing. */
  let generation = 0
  /** The person is inside a server-detected speech region. */
  let utteranceOpen = false
  /** The current utterance has a definitive human-speech boundary. */
  let utteranceEnded = true
  /** Once present, server VAD — rather than transcript arrival order — owns ids. */
  let activitySignalsSeen = false
  /** Human utterance the current model response answers. */
  let generationUtterance = 0
  /**
   * The model is part-way through one response.
   *
   * A response ends when the API says so — `generationComplete`, `turnComplete`,
   * `interrupted`, or this route being released — and at no other time. It used
   * to end whenever the utterance counter moved, which meant one response
   * streaming while the counter advanced was split across two generation ids and
   * charged to two different turns.
   */
  let generationOpen = false
  /** Locally closed turns whose delayed server `turnComplete` is still expected. */
  let pendingServerTurnEnds = 0
  const idleFinalize = createRearmableTimer()
  let rejectConnect: (reason: unknown) => void = () => undefined
  const connectFailed = new Promise<never>((_, reject) => {
    rejectConnect = reject
  })

  const abandonPendingConnection = () => {
    if (!connected) {
      abandoned = true
      try {
        pendingSocket?.close()
      } catch {
        // The browser may already be dispatching this socket's close event.
      }
      rejectConnect(sessionError('live-connection-failed'))
    }
  }

  const reportTurnEnd = () => {
    idleFinalize.cancel()
    generationOpen = false
    if (turnOpen) {
      turnOpen = false
      options.events.onTurnEnd(utterance, generation)
    }
  }

  /**
   * Begin one server-detected human utterance.
   *
   * A new speech start is also a local boundary for a server turn whose
   * `turnComplete` is still delayed by realtime playback. The delayed message is
   * consumed later instead of being allowed to close the new human turn.
   */
  const beginUtterance = (fromActivity = false) => {
    if (fromActivity) activitySignalsSeen = true
    if (utteranceOpen) return

    // With VAD signals, a transcription delivered after ACTIVITY_END is late
    // evidence for that same utterance, so ACTIVITY_START normally creates the
    // next id. Only while the route is still working on that utterance, though:
    // once it has handed it back, the next thing transcribed is the next thing
    // somebody said. `voiceActivity` is a newer, partly gated Live feature, and
    // deferring to signals that have stopped arriving froze the utterance id
    // after the first turn — every later transcription was then dropped as
    // already committed and the conversation ended at one exchange.
    if (!fromActivity && activitySignalsSeen && utterance > 0 && turnOpen) {
      return
    }

    if (turnOpen && utterance > 0) {
      reportTurnEnd()
      pendingServerTurnEnds += 1
    }

    utterance += 1
    utteranceOpen = true
    utteranceEnded = false
    sourceTranscript = null
    turnOpen = true
    // Whatever the model was saying was an answer to the previous utterance.
    generationOpen = false
    if (generation > 0 && generationUtterance === 0) {
      generationUtterance = utterance
    }
    options.events.onSpeechStart(utterance)
  }

  /** Seal the human-speech boundary once, independently of model playback. */
  const endUtterance = () => {
    if (utterance === 0 || utteranceEnded) return
    utteranceOpen = false
    utteranceEnded = true
    options.events.onSpeechEnd(utterance)
  }

  /** Begin the response for the current human utterance. */
  const beginGeneration = () => {
    if (generationOpen) return
    generation += 1
    generationOpen = true
    generationUtterance = utterance
    translationTranscript = null
  }

  /** Hand the current server turn back to the session. */
  const endTurn = () => {
    endUtterance()
    reportTurnEnd()
  }

  const armIdleFinalize = () => {
    if (!turnOpen) {
      idleFinalize.cancel()
      return
    }
    // `turnComplete` is not guaranteed: an interrupted turn skips
    // `generationComplete`, and a session that goes away mid-utterance sends
    // neither. Ending the turn locally releases this route to take part in the
    // next utterance; it never truncates or discards anything already reported.
    idleFinalize.arm(TRANSCRIPT_IDLE_FINALIZE_MS, endTurn)
  }

  const connectPromise = connectWithSocketCapture(
    () =>
      client.live.connect({
        model: options.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{ text: options.systemInstruction }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              endOfSpeechSensitivity: END_OF_SPEECH_SENSITIVITY,
              silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
            },
          },
          translationConfig: {
            targetLanguageCode: options.targetLanguage,
            // The API's own arbitration between the two routes of a pair: the
            // route whose target is the language being spoken stays silent, so
            // only the other one interprets. `translationConfig` has no source
            // field, so this is the only per-route audio control there is.
            echoTargetLanguage: false,
          },
        },
        callbacks: {
          onmessage: (message) => {
            // The SDK calls this from an async handler and discards anything thrown,
            // so a raw throw here would surface as an unhandled rejection and the
            // rest of the message would be silently lost.
            try {
              const activity =
                message.voiceActivity?.voiceActivityType ??
                message.voiceActivityDetectionSignal?.vadSignalType
              if (
                activity === 'ACTIVITY_START' ||
                activity === 'VAD_SIGNAL_TYPE_SOS'
              ) {
                beginUtterance(true)
              } else if (
                activity === 'ACTIVITY_END' ||
                activity === 'VAD_SIGNAL_TYPE_EOS'
              ) {
                activitySignalsSeen = true
                endUtterance()
              }

              const content = message.serverContent
              if (!content) {
                armIdleFinalize()
                return
              }

              if (content.interrupted) {
                // Only the model's *output* was cut off, so its queued audio is
                // stale. What the speaker said is not, and has already been
                // reported, so the coordinator keeps the turn it belongs to.
                const wasOpen = turnOpen
                generationOpen = false
                options.events.onInterrupted(generation)
                endTurn()
                if (wasOpen) pendingServerTurnEnds += 1
              }

              if (hasSpeech(content.interimInputTranscription)) {
                // Deliberately after `beginUtterance`, which asks whether this
                // route already had a turn open. Setting it first answered
                // "yes" for the first message of every new utterance, ending a
                // turn that was already over and leaving the route expecting a
                // server `turnComplete` that had already been consumed.
                beginUtterance()
                turnOpen = true
                options.events.onInterimTranscript(
                  content.interimInputTranscription!,
                  utterance,
                )
              }
              if (content.inputTranscription) {
                if (hasSpeech(content.inputTranscription)) {
                  beginUtterance()
                  turnOpen = true
                  sourceTranscript = mergeTranscription(
                    sourceTranscript,
                    content.inputTranscription,
                  )
                  // Live Translate finalizes transcription segments here.
                  // Several `finished=true` segments may still be one human
                  // thought; the coordinator joins their transport ids while
                  // the product turn remains open.
                  const finished = content.inputTranscription.finished !== false
                  options.events.onSourceTranscript(
                    sourceTranscript,
                    finished,
                    utterance,
                  )
                  if (finished) endUtterance()
                } else if (content.inputTranscription.finished !== false) {
                  // A boundary with nothing in it. It closes the utterance that
                  // is open, and creates nothing: nobody said anything.
                  endUtterance()
                }
              }
              if (hasSpeech(content.outputTranscription)) {
                beginGeneration()
                turnOpen = true
                translationTranscript = mergeTranscription(
                  translationTranscript,
                  content.outputTranscription!,
                )
                options.events.onTranslationTranscript(
                  translationTranscript,
                  generation,
                )
              }

              for (const chunk of readAudioParts(message)) {
                beginGeneration()
                turnOpen = true
                options.events.onAudio(chunk, generation)
              }

              if (content.generationComplete) {
                generationOpen = false
                // The output boundary: the SDK documents turnComplete as
                // arriving later while the server waits out its realtime
                // playback estimate. Audio release and browser playback must
                // never wait for that server-side estimate.
                options.events.onGenerationComplete(generation)
                // The model has answered what it heard, so whatever is
                // transcribed next is the next thing somebody said. This is the
                // boundary that still holds if the API never marks an input
                // transcription finished.
                endUtterance()
              }

              if (content.turnComplete) {
                if (pendingServerTurnEnds > 0) {
                  pendingServerTurnEnds -= 1
                } else {
                  endTurn()
                }
              }

              armIdleFinalize()
            } catch {
              // One malformed message must not tear down a working session.
            }
          },
          onerror: () => {
            abandonPendingConnection()
            if (connected) {
              options.events.onError()
            }
          },
          onclose: () => {
            abandonPendingConnection()
            if (connected) {
              options.events.onClosed(closedByClient)
            }
          },
        },
      }),
    (socket) => {
      pendingSocket = socket
    },
  )

  const abortConnect = () => {
    abandonPendingConnection()
  }
  if (options.signal.aborted) {
    abortConnect()
  } else {
    options.signal.addEventListener('abort', abortConnect, { once: true })
  }

  // If we give up first, close the session should the SDK resolve afterwards.
  void connectPromise.then(
    (late) => {
      if (abandoned) {
        try {
          late.close()
        } catch {
          // Nothing to release if the socket already went away.
        }
      }
    },
    () => undefined,
  )

  const timeout = setTimeout(() => {
    abandonPendingConnection()
  }, CONNECT_TIMEOUT_MS)

  let session: Session
  try {
    session = await Promise.race([connectPromise, connectFailed])
    connected = true
  } catch {
    abandoned = true
    // Deliberately does not forward the SDK error: it can carry request URLs
    // that include the token.
    throw sessionError('live-connection-failed')
  } finally {
    clearTimeout(timeout)
    options.signal.removeEventListener('abort', abortConnect)
  }

  return {
    sendAudioChunk: (base64Pcm16) => {
      if (closedByClient) {
        return
      }
      try {
        session.sendRealtimeInput({
          audio: { data: base64Pcm16, mimeType: INPUT_AUDIO_MIME_TYPE },
        })
      } catch {
        // The socket can close between the guard and the send; the close
        // callback is what drives the session into its error state.
      }
    },
    close: () => {
      if (closedByClient) {
        return
      }
      closedByClient = true
      // Nothing may reach the event callbacks after the caller has released the
      // transport, so the idle window is dropped rather than allowed to run.
      idleFinalize.cancel()
      try {
        // Documented signal that the microphone was turned off while automatic
        // activity detection is on. We close immediately after and do not wait
        // for a server-side flush: stopping must release resources promptly.
        session.sendRealtimeInput({ audioStreamEnd: true })
      } catch {
        // Already closing.
      }
      try {
        session.close()
      } catch {
        // The socket may already be closing; nothing further to release here.
      }
    },
  }
}
