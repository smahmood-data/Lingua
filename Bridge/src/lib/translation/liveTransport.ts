import { GoogleGenAI, Modality } from '@google/genai'
import type { LiveServerMessage, Session, Transcription } from '@google/genai'
import {
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
  /** A transcription fragment from the API. Never synthesised locally. */
  onTranscript: (kind: TranscriptKind, transcription: Transcription) => void
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
    if (inlineData?.data && inlineData.mimeType?.startsWith('audio/')) {
      chunks.push(base64ToBytes(inlineData.data))
    }
  }

  return chunks
}

/**
 * Connect to Gemini Live Translate and normalise its messages into the small
 * event set the session controller needs.
 *
 * The browser authenticates with the ephemeral token only; ephemeral tokens are
 * served on the v1alpha endpoint.
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

  let closedByClient = false
  let session: Session

  try {
    session = await client.live.connect({
      model: options.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: target,
          // The demo runs on one laptop, so the translated English audio is
          // audible to the microphone. Not echoing the target language keeps
          // the model from translating its own output back again.
          echoTargetLanguage: false,
        },
      },
      callbacks: {
        onmessage: (message) => {
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

          if (content.inputTranscription) {
            options.events.onTranscript('source', content.inputTranscription)
          }
          if (content.outputTranscription) {
            options.events.onTranscript('translation', content.outputTranscription)
          }

          if (content.turnComplete) {
            options.events.onTurnComplete()
          }
        },
        onerror: () => {
          options.events.onError()
        },
        onclose: () => {
          options.events.onClosed(closedByClient)
        },
      },
    })
  } catch {
    // Deliberately does not forward the SDK error: it can carry request URLs
    // that include the token.
    throw sessionError('live-connection-failed')
  }

  return {
    sendAudioChunk: (base64Pcm16) => {
      if (closedByClient) {
        return
      }
      session.sendRealtimeInput({
        audio: { data: base64Pcm16, mimeType: INPUT_AUDIO_MIME_TYPE },
      })
    },
    close: () => {
      if (closedByClient) {
        return
      }
      closedByClient = true
      try {
        session.close()
      } catch {
        // The socket may already be closing; nothing further to release here.
      }
    },
  }
}
