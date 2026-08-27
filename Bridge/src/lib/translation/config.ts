import type { TranslationDirection } from './types'

/**
 * Live translation model.
 *
 * The server is the source of truth: the ephemeral token from #1 is expected to
 * be constrained to a model, and `/api/live-token` may return that model id. This
 * constant is only the fallback, and mirrors `GEMINI_LIVE_MODEL` in `.env.example`.
 * Preview model ids change — confirm in Google AI Studio before the demo.
 */
export const DEFAULT_LIVE_MODEL = 'gemini-3.5-live-translate-preview'

/** Ephemeral tokens are only served on the v1alpha endpoint. */
export const LIVE_API_VERSION = 'v1alpha'

/** Server route that mints the short-lived token. Owned by Issue #1. */
export const LIVE_TOKEN_ENDPOINT = '/api/live-token'

/** Gemini Live requires 16 kHz mono PCM16 input. */
export const INPUT_SAMPLE_RATE = 16000

/** Gemini Live returns 24 kHz mono PCM16 audio. */
export const OUTPUT_SAMPLE_RATE = 24000

/** Chunk length sent to the API. 100 ms keeps latency low without flooding the socket. */
export const CAPTURE_CHUNK_MS = 100

/** MIME type for realtime audio input, including the required sample rate. */
export const INPUT_AUDIO_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

interface DirectionLanguages {
  /** BCP-47 code of the language being spoken into the microphone. */
  source: string
  /** BCP-47 code Gemini should translate into. */
  target: string
}

const DIRECTION_LANGUAGES: Record<TranslationDirection, DirectionLanguages> = {
  'ur-to-en': { source: 'ur', target: 'en' },
  'en-to-ur': { source: 'en', target: 'ur' },
}

export function languagesForDirection(
  direction: TranslationDirection,
): DirectionLanguages {
  return DIRECTION_LANGUAGES[direction]
}
