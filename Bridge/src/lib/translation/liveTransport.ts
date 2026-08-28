import { GoogleGenAI, Modality } from '@google/genai'
import type { LiveServerMessage, Session, Transcription } from '@google/genai'
import {
  CONNECT_TIMEOUT_MS,
  END_OF_SPEECH_SENSITIVITY,
  END_OF_SPEECH_SILENCE_MS,
  INPUT_AUDIO_MIME_TYPE,
  LIVE_API_VERSION,
  TRANSCRIPT_IDLE_FINALIZE_MS,
  TRANSCRIPT_SETTLE_MS,
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
 * below and leaves every judgement to `TranslationSession`.
 */
export interface LiveTransportEvents {
  /** Translated audio, as little-endian PCM16 at `OUTPUT_SAMPLE_RATE`. */
  onAudio: (pcm16: Uint8Array) => void
  /** Consolidated transcription of one thing the speaker said. */
  onSourceTranscript: (transcription: Transcription) => void
  /** Consolidated transcription of what this route generated for that speech. */
  onTranslationTranscript: (transcription: Transcription) => void
  /** Speculative partial transcription of the speaker, updated while talking. */
  onInterimTranscript: (transcription: Transcription) => void
  /** The model's current output was cut off; queued playback is stale. */
  onInterrupted: () => void
  /** This route is finished with the utterance it was working on. */
  onTurnEnd: () => void
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
 * A single rearmable timeout. Arming replaces any pending run, so the callers
 * below can extend a settle window without tracking handles themselves.
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
  const sourceSettle = createRearmableTimer()
  const translationSettle = createRearmableTimer()
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

  const flushSource = () => {
    sourceSettle.cancel()
    const pending = sourceTranscript
    sourceTranscript = null
    if (pending?.text?.trim()) {
      options.events.onSourceTranscript(pending)
    }
  }

  const flushTranslation = () => {
    translationSettle.cancel()
    const pending = translationTranscript
    translationTranscript = null
    if (pending?.text?.trim()) {
      options.events.onTranslationTranscript(pending)
    }
  }

  const flushTranscripts = () => {
    flushSource()
    flushTranslation()
  }

  /** Publish whatever is known and hand the utterance back to the session. */
  const endTurn = () => {
    idleFinalize.cancel()
    flushTranscripts()
    if (turnOpen) {
      turnOpen = false
      options.events.onTurnEnd()
    }
  }

  const armIdleFinalize = () => {
    if (!turnOpen) {
      idleFinalize.cancel()
      return
    }
    // `turnComplete` is not guaranteed: an interrupted turn skips
    // `generationComplete`, and a session that goes away mid-utterance sends
    // neither. Closing the turn locally only publishes text the API already
    // sent and releases the route to arbitrate the next utterance.
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
              const content = message.serverContent
              if (!content) {
                return
              }

              if (content.interrupted) {
                // Only the model's *output* was cut off, so its queued audio is
                // stale. What the speaker said is not: publish it rather than
                // losing a turn they actually spoke.
                options.events.onInterrupted()
                endTurn()
              }

              if (content.interimInputTranscription) {
                turnOpen = true
                options.events.onInterimTranscript(
                  content.interimInputTranscription,
                )
              }
              if (content.inputTranscription) {
                turnOpen = true
                sourceTranscript = mergeTranscription(
                  sourceTranscript,
                  content.inputTranscription,
                )
                if (content.inputTranscription.finished) {
                  // The API says this is the whole utterance, so there is
                  // nothing to wait for.
                  flushSource()
                } else {
                  // Otherwise settle briefly, so a trailing fragment joins the
                  // row it belongs to instead of starting a new one.
                  sourceSettle.arm(TRANSCRIPT_SETTLE_MS, flushSource)
                }
              }
              if (content.outputTranscription) {
                turnOpen = true
                translationTranscript = mergeTranscription(
                  translationTranscript,
                  content.outputTranscription,
                )
                if (content.outputTranscription.finished) {
                  flushTranslation()
                } else {
                  translationSettle.arm(TRANSCRIPT_SETTLE_MS, flushTranslation)
                }
              }

              for (const chunk of readAudioParts(message)) {
                turnOpen = true
                options.events.onAudio(chunk)
              }

              if (content.generationComplete) {
                // The model has stopped generating. `turnComplete` then waits
                // for its realtime playback estimate to drain, which is several
                // seconds later, so the transcript is settled from here.
                flushSource()
                translationSettle.arm(TRANSCRIPT_SETTLE_MS, flushTranslation)
              }

              if (content.turnComplete) {
                endTurn()
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
      // transport, so the settle windows are dropped rather than allowed to run.
      sourceSettle.cancel()
      translationSettle.cancel()
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
