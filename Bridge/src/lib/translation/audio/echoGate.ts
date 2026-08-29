/**
 * Deciding whether the microphone is hearing a person or our own speakers.
 *
 * Translated speech comes out of the same device the microphone is listening
 * to, so audio captured while it plays is normally the app hearing itself. The
 * previous answer was to replace the room with digital silence for the whole of
 * translation and playback, which made recursive translation impossible — and
 * made interrupting the translation impossible too, because Gemini never heard
 * a single sample of the person trying to speak.
 *
 * This is the middle position. Nothing captured during playback is ever sent
 * until it is loud enough, for long enough, to be a person rather than the
 * residue the browser's echo canceller left behind. When it is, the gate says
 * so once, and the chunks it was holding are released so the first word of the
 * interruption is not lost.
 *
 * The measurement is deliberately relative. `echoCancellation: true` usually
 * leaves almost nothing, but on external speakers at volume it leaves a lot;
 * comparing against what this room and this device are actually producing right
 * now adapts to both, where a fixed threshold would either never fire or fire
 * constantly.
 *
 * The honest limit of this, and there is one: a voice that is already at full
 * volume in the very first chunk of a translation is measured as part of what
 * that translation sounds like, and does not interrupt it. Nothing available in
 * the browser can separate the two at that instant — both are simply energy on
 * one microphone. It resolves itself within about a tenth of a second, because
 * the floor is re-measured continuously and one ordinary gap between words
 * drops it back to the room; and the words are not lost either way, since the
 * turn is still heard normally once the translation finishes.
 */

/** What the session should do with one captured chunk. */
export type GateDecision =
  /** Send the room as captured. */
  | 'pass'
  /** Send silence: this is our own speakers, or the guard after them. */
  | 'suppress'
  /** A person is talking over the translation. Sent with the held chunks. */
  | 'barge-in'

export interface EchoGateOptions {
  /**
   * Consecutive chunks above the threshold before an interruption is declared.
   *
   * A syllable of echo that slips past the canceller is one chunk; somebody
   * starting to speak is many. At 100 ms per chunk this is the difference
   * between a click and a word.
   */
  triggerChunks: number
  /** How far above the measured background input has to be to count. */
  ratio: number
  /** Level below which nothing is ever a person, however quiet the room is. */
  absoluteFloor: number
  /** Chunks of playback used to measure what our own speakers sound like. */
  settleChunks: number
  /** Chunks held back so the first word survives being suppressed. */
  prebufferChunks: number
}

export const DEFAULT_ECHO_GATE_OPTIONS: EchoGateOptions = {
  triggerChunks: 2,
  ratio: 2.5,
  absoluteFloor: 0.02,
  settleChunks: 2,
  prebufferChunks: 3,
}

/** Root mean square of one chunk, i.e. how loud it is. */
export function chunkLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

export interface EchoGate {
  /** Classify one captured chunk. */
  inspect: (samples: Float32Array) => GateDecision
  /** The speakers started or stopped producing translated speech. */
  setSpeaking: (speaking: boolean) => void
  /**
   * Chunks held back while suppressed, oldest first, and forget them.
   *
   * Called when `inspect` returns `barge-in` so the words that were being
   * measured are still sent, rather than the interruption starting mid-word.
   */
  takePrebuffer: () => Float32Array[]
  /** Forget everything measured. Used when a session's resources change. */
  reset: () => void
}

export function createEchoGate(
  options: EchoGateOptions = DEFAULT_ECHO_GATE_OPTIONS,
): EchoGate {
  /**
   * Loudness of our own playback as this microphone hears it back.
   *
   * Measured per stretch of playback, because volume, output device and the
   * distance between speakers and microphone all change — and because it is a
   * measurement of the room *and* the residue together, which is exactly what
   * a person has to be louder than.
   */
  let echoLevel = 0
  let settleSeen = 0
  let speaking = false
  let consecutive = 0
  let prebuffer: Float32Array[] = []

  const remember = (samples: Float32Array) => {
    prebuffer.push(samples)
    while (prebuffer.length > options.prebufferChunks) prebuffer.shift()
  }

  const threshold = () => Math.max(echoLevel * options.ratio, options.absoluteFloor)

  return {
    setSpeaking(next) {
      if (next === speaking) return
      speaking = next
      consecutive = 0
      prebuffer = []
      if (next) {
        // Each stretch of playback is measured on its own: volume, output
        // device and how far the speakers are from the microphone all change.
        echoLevel = 0
        settleSeen = 0
      }
    },

    inspect(samples) {
      const level = chunkLevel(samples)

      if (!speaking) {
        consecutive = 0
        return 'pass'
      }

      if (settleSeen < options.settleChunks) {
        // Still learning what our own speakers sound like through this
        // microphone. Nothing goes out, but it is kept in case this is somebody
        // who started talking immediately. The quietest of these readings is
        // taken, not the loudest, so a person who was already mid-word when the
        // translation began does not raise the bar they then have to clear.
        settleSeen += 1
        echoLevel = settleSeen === 1 ? level : Math.min(echoLevel, level)
        remember(samples)
        return 'suppress'
      }

      if (level > threshold()) {
        consecutive += 1
        remember(samples)
        if (consecutive >= options.triggerChunks) {
          consecutive = 0
          return 'barge-in'
        }
        return 'suppress'
      }

      consecutive = 0
      // Not a candidate, so nothing before it is worth releasing either.
      prebuffer = []
      // Our own speakers, so this also refines what they sound like: the
      // running floor of the stream, allowed to drift up if playback gets
      // louder but never pulled up by one loud moment. It is also how somebody
      // who was already mid-word when the translation started gets heard — one
      // ordinary gap between words re-measures the floor beneath them.
      echoLevel = Math.min(echoLevel * 1.05, level)
      return 'suppress'
    },

    takePrebuffer() {
      const held = prebuffer
      prebuffer = []
      return held
    },

    reset() {
      echoLevel = 0
      settleSeen = 0
      speaking = false
      consecutive = 0
      prebuffer = []
    },
  }
}
