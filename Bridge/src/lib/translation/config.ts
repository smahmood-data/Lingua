// Type-only, so the token endpoint can share these constants without pulling
// the browser SDK into a serverless bundle.
import type { EndSensitivity } from '@google/genai'

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

/**
 * Non-speech the API must hear before it commits end-of-speech.
 *
 * Long enough that a natural mid-sentence pause does not split an utterance,
 * short enough that the speaker's turn closes while the conversation still
 * feels live.
 */
export const END_OF_SPEECH_SILENCE_MS = 700

/**
 * How readily automatic activity detection decides speech has ended.
 *
 * This is the documented Gemini Live default, restated because the alternative
 * is tempting and wrong for this product: `END_SENSITIVITY_LOW` "ends speech
 * less often", so in a room with steady background noise the turn can stay
 * open indefinitely and nothing is ever transcribed. Tolerance for pauses
 * comes from `END_OF_SPEECH_SILENCE_MS` instead.
 *
 * The ephemeral token carries the session setup it constrains, so this value
 * has to match on both sides: the token request in `api/live-token.ts` and the
 * browser's Live config in `liveTransport.ts`.
 */
export const END_OF_SPEECH_SENSITIVITY =
  'END_SENSITIVITY_HIGH' as EndSensitivity

/**
 * Grace period that lets the trailing pieces of one utterance's transcription
 * join the row they belong to.
 *
 * Input transcription arrives as a complete utterance and output transcription
 * streams word by word, but neither is ordered against `serverContent`, so a
 * fragment can land just after the signal that the turn is over. Committing a
 * transcript row this long after the last fragment keeps one spoken sentence in
 * one row without waiting on the model.
 */
export const TRANSCRIPT_SETTLE_MS = 300

/**
 * Fallback that commits already-transcribed text when the API stops talking
 * about the turn without ever closing it.
 *
 * This never truncates speech and never stops the microphone: it only publishes
 * text the API has already sent, so the worst case is a row that is committed
 * slightly early and continues in the next row. It exists because
 * `turnComplete` is not guaranteed to arrive — an interrupted turn skips
 * `generationComplete`, and a session that goes away mid-utterance sends
 * neither.
 */
export const TRANSCRIPT_IDLE_FINALIZE_MS = 2000

/** Prevent translated speaker audio from being captured and translated back. */
export const PLAYBACK_ECHO_GUARD_MS = 350

/**
 * Extra time allowed past the end of the scheduled audio before the session
 * stops believing playback is still running.
 *
 * The microphone is fed silence while the translation is audible, so a playback
 * completion that never arrives would leave the session deaf and permanently
 * "playing". The playback scheduler reports how much audio is still queued on
 * its own clock, so the watchdog only has to cover the gap between that clock
 * running out and the callback being delivered.
 */
export const PLAYBACK_WATCHDOG_SLACK_MS = 1500

/**
 * Ceiling on audio a route may hold while it is not yet known whether it owns
 * the utterance, in bytes of PCM16 at `OUTPUT_SAMPLE_RATE` (about ten seconds).
 *
 * Ownership is normally settled before the first chunk arrives; the buffer only
 * covers the case where the deciding evidence is a beat behind the audio.
 */
export const MAX_UNOWNED_AUDIO_BYTES = OUTPUT_SAMPLE_RATE * 2 * 10

/** MIME type for realtime audio input, including the required sample rate. */
export const INPUT_AUDIO_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

/** Auto-detected speech is translated into English until the user chooses otherwise. */
export const DEFAULT_TARGET_LANGUAGE = 'en'

/** Auto mode is retained, but users can choose an explicit source language. */
export const DEFAULT_SOURCE_LANGUAGE = 'auto'
