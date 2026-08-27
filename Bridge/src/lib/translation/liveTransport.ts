import { GoogleGenAI, Modality } from '@google/genai'
import type { LiveServerMessage, Session, Transcription } from '@google/genai'
import {
  CONNECT_TIMEOUT_MS,
  INPUT_AUDIO_MIME_TYPE,
  LIVE_API_VERSION,
  languagesForDirection,
} from './config'
import { sessionError } from './errors'
import type { TranscriptKind, TranslationDirection } from './types'
import { base64ToBytes } from './audio/pcm'

export interface LiveTransportEvents {
  /** Translated audio, as little-endian PCM16 at `OUTPUT_SAMPLE_RATE`. */
  onAudio: (pcm16: Uint8Array) => void
  /** A finalised transcription segment from the API. Never synthesised locally. */
  onTranscript: (kind: TranscriptKind, transcription: Transcription) => void
  /** Speculative partial transcription of the speaker, updated while talking. */
  onInterimTranscript: (transcription: Transcription) => void
  /** The model's current output was cut off; queued playback should be dropped. */
  onInterrupted: () => void
  /** The model finished a turn. */
  onTurnComplete: () => void
  /** The socket closed. `expected` is false for a drop we did not initiate. */
  onClosed: (expected: boolean) => void
  /** A transport-level error, ahead of the close event. */
  onError: () => void
}

export interface LiveTransportOptions {
  /** Short-lived ephemeral token from the server. Never the long-lived key. */
  token: string
  model: string
  direction: TranslationDirection
  events: LiveTransportEvents
}

export interface LiveTransport {
  sendAudioChunk: (base64Pcm16: string) => void
  close: () => void
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
  // Gemini Live Translate auto-detects the spoken language; only the target
  // language is configured.
  const { target } = languagesForDirection(options.direction)
  const client = new GoogleGenAI({
    apiKey: options.token,
    httpOptions: { apiVersion: LIVE_API_VERSION },
  })

  let connected = false
  let abandoned = false
  let closedByClient = false
  let rejectConnect: (reason: unknown) => void = () => undefined
  const connectFailed = new Promise<never>((_, reject) => {
    rejectConnect = reject
  })

  const failBeforeConnected = () => {
    if (!connected) {
      abandoned = true
      rejectConnect(sessionError('live-connection-failed'))
    }
  }

  const connectPromise = client.live.connect({
    model: options.model,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      translationConfig: {
        targetLanguageCode: target,
        // The demo runs on one laptop, so the translated target-language audio is
        // audible to the microphone. Not echoing the target language keeps
        // the model from translating its own output back again.
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
            options.events.onInterrupted()
          }

          for (const chunk of readAudioParts(message)) {
            options.events.onAudio(chunk)
          }

          if (content.interimInputTranscription) {
            options.events.onInterimTranscript(content.interimInputTranscription)
          }
          if (content.inputTranscription) {
            options.events.onTranscript('source', content.inputTranscription)
          }
          if (content.outputTranscription) {
            options.events.onTranscript('translation', content.outputTranscription)
          }

          if (content.turnComplete) {
            options.events.onTurnComplete()
          }
        } catch {
          // One malformed message must not tear down a working session.
        }
      },
      onerror: () => {
        failBeforeConnected()
        if (connected) {
          options.events.onError()
        }
      },
      onclose: () => {
        failBeforeConnected()
        if (connected) {
          options.events.onClosed(closedByClient)
        }
      },
    },
  })

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
    if (!connected) {
      abandoned = true
      rejectConnect(sessionError('live-connection-failed'))
    }
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
