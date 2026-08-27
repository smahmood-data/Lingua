import type { TranslationDirection } from './types'

/**
 * Live translation model.
 *
 * The server is the source of truth: the ephemeral token from #1 is expected to
 * be constrained to a model, and `/api/live-token` may return that model id. This
 * constant is only the fallback, and mirrors `GEMINI_LIVE_MODEL` in the backend
 * environment template.
 * Preview model ids change — confirm in Google AI Studio before the demo.
 */
export const DEFAULT_LIVE_MODEL = 'gemini-3.5-live-translate-preview'

/**
 * API version used for the browser's Live WebSocket connection.
 *
 * VERIFY THIS ON THE FIRST REAL RUN — the sources disagree:
 *
 * - The Live Translate documentation says ephemeral tokens must use the
 *   `v1beta` endpoint, and that is also the version the Issue #1 server mints
 *   tokens on (`GEMINI_API_BASE_URL` defaults to `.../v1beta`). A token is
 *   redeemed on the version that issued it, so `v1beta` is the consistent
 *   choice and is what this constant selects.
 * - `@google/genai` 2.19.0 still prints "The SDK's ephemeral token support is
 *   in v1alpha only" when the version is anything else. That warning is only a
 *   `console.warn`: the SDK switches to the constrained ephemeral method and
 *   the `access_token` query parameter purely on the `auth_tokens/` prefix of
 *   the key, independently of this version.
 *
 * If the first live session fails during the WebSocket handshake, flip this to
 * `'v1alpha'` and confirm which one the account actually accepts. Changing it
 * is a one-line switch precisely so that test is cheap.
 */
export const LIVE_API_VERSION = 'v1beta'

/** Server route that mints the short-lived token. Owned by Issue #1. */
export const LIVE_TOKEN_ENDPOINT = '/api/live-token'

/**
 * Ceiling on the Live handshake (socket open plus `setupComplete`).
 *
 * The SDK's connect promise never settles on failure, so without this a socket
 * that opens and then goes quiet would leave the session stuck in `connecting`.
 */
export const CONNECT_TIMEOUT_MS = 15000

/**
 * Prefix every Gemini ephemeral token carries.
 *
 * `@google/genai` keys its ephemeral handling off this prefix: a value without
 * it is sent as `?key=<value>` on the ordinary Live method, i.e. treated as a
 * long-lived API key. Rejecting anything else keeps a misconfigured server from
 * turning into a credential leak in the browser.
 */
export const EPHEMERAL_TOKEN_PREFIX = 'auth_tokens/'

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
