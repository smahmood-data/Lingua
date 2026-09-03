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
 * Current Gemini documentation requires ephemeral tokens to use the `v1beta`
 * constrained endpoint, and the server mints them through the same version.
 * `@google/genai` 2.19.0 still prints an older “v1alpha only” warning, but its
 * runtime correctly selects `BidiGenerateContentConstrained` and the
 * `access_token` query parameter from the `auth_tokens/` prefix. Changing this
 * to v1alpha would silence that stale warning while contradicting the current
 * service contract.
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
 * The browser traces show `END_SENSITIVITY_HIGH` breaking ordinary Spanish and
 * Bengali speech into new model turns after short mid-sentence pauses. Gemini's
 * documented meaning of `END_SENSITIVITY_LOW` is exactly what the interpreter
 * needs here: end speech less readily while still retaining the bounded
 * `silenceDurationMs` fallback above.
 *
 * The ephemeral token carries the session setup it constrains, so this value
 * has to match on both sides: the token request in `api/live-token.ts` and the
 * browser's Live config in `liveTransport.ts`.
 */
export const END_OF_SPEECH_SENSITIVITY =
  'END_SENSITIVITY_LOW' as EndSensitivity

/**
 * How long a source-only server turn remains joinable by another finalized ASR
 * segment from the same human thought.
 *
 * Gemini marked the real trace fragments `finished=true` roughly 0.6–1.0 s
 * apart even though the speaker had not finished. `finished` ends that ASR
 * segment; it is not by itself a product-level conversational boundary. This
 * window is only used when no translated audio owns the turn (audio playback
 * already keeps translated turns open while trailing segments arrive).
 */
export const UTTERANCE_JOIN_MS = 1200

/**
 * How long a route may go without saying anything about the utterance it is
 * reporting before it is released from it.
 *
 * `turnComplete` is not guaranteed — an interrupted turn skips
 * `generationComplete`, and a session that goes away mid-utterance sends
 * neither — and a route that never reports the end of an utterance would still
 * be counted as busy with it while the next person is speaking. Nothing is
 * truncated or discarded when this fires; the route simply rejoins the
 * conversation.
 */
export const TRANSCRIPT_IDLE_FINALIZE_MS = 1200

/**
 * Quiet period after translated speech before the microphone is heard again.
 *
 * Short: the second speaker replies immediately in a real conversation, and a
 * long dead period after every turn is the difference between an interpreter
 * and a walkie-talkie. This is not part of "playing the translation" — playback
 * is already physically over when it starts.
 */
export const PLAYBACK_ECHO_GUARD_MS = 250

/**
 * Whether the microphone is closed while an utterance is being interpreted.
 *
 * It is not, and that is a deliberate reversal. Nothing is coming out of the
 * speakers between the end of somebody's sentence and the start of the
 * translated reply, so there is nothing to echo — and that gap is exactly when
 * the other person starts talking. Closing it was a large part of why a second
 * turn so often never happened.
 */
export const MUTE_WHILE_TRANSLATING = false

/**
 * Barge-in is deliberately disabled for the normal-conversation pass.
 *
 * Captured speech repeatedly tripped the experimental echo gate in the real
 * traces and committed unfinished turns. While translated speech is audible we
 * now send silence to Gemini; interruption can be reintroduced separately once
 * ordinary alternating conversation is stable.
 *
 * The behaviour is still fully specified: the barge-in cases in
 * `interpreter.test.ts` are gated on this flag rather than skipped, and they
 * pass when it is true. What is unsolved is acoustic, not logical — separating
 * a voice from our own speakers needs an echo-cancellation reference signal
 * rather than the loudness heuristic in `audio/echoGate.ts`.
 */
export const BARGE_IN_ENABLED = false

/**
 * Consecutive above-threshold capture chunks that count as an interruption.
 *
 * At `CAPTURE_CHUNK_MS` each, two is about a fifth of a second: long enough
 * that a syllable of echo the canceller missed is not an interruption, short
 * enough that the speakers stop before the person has finished their first
 * word.
 */
export const BARGE_IN_TRIGGER_CHUNKS = 2

/**
 * How far above the room, and above our own speakers as the microphone hears
 * them, input has to be before it is treated as a person.
 *
 * Relative rather than absolute on purpose: with `echoCancellation: true` on
 * one laptop the residue is nearly nothing, and on external speakers at volume
 * it is substantial. A fixed number would either never fire or fire constantly.
 */
export const BARGE_IN_LEVEL_RATIO = 2.5

/** Level below which nothing is a person, however quiet the room is. */
export const BARGE_IN_ABSOLUTE_FLOOR = 0.02

/** Chunks of playback used to measure what our own speakers sound like. */
export const BARGE_IN_SETTLE_CHUNKS = 2

/**
 * Chunks kept back while playback is being measured, so that the first word of
 * an interruption is sent rather than swallowed by the measurement.
 */
export const BARGE_IN_PREBUFFER_CHUNKS = 3

/** MIME type for realtime audio input, including the required sample rate. */
export const INPUT_AUDIO_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

/** Auto-detected speech is translated into English until the user chooses otherwise. */
export const DEFAULT_TARGET_LANGUAGE = 'en'

/** Auto mode is retained, but users can choose an explicit source language. */
export const DEFAULT_SOURCE_LANGUAGE = 'auto'
