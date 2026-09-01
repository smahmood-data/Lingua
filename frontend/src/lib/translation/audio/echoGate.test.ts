import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ECHO_GATE_OPTIONS,
  chunkLevel,
  createEchoGate,
  type GateDecision,
} from './echoGate'

/** One 100 ms chunk at a given loudness. */
function chunk(level: number) {
  const samples = new Float32Array(1600)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? level : -level
  }
  return samples
}

function feed(
  gate: ReturnType<typeof createEchoGate>,
  level: number,
  count: number,
): GateDecision[] {
  const decisions: GateDecision[] = []
  for (let index = 0; index < count; index += 1) {
    decisions.push(gate.inspect(chunk(level)))
  }
  return decisions
}

const QUIET = 0.004
const ECHO = 0.012
const LOUD_ECHO = 0.3
const VOICE = 0.35

describe('echo gate', () => {
  it('measures loudness as the RMS of the chunk', () => {
    expect(chunkLevel(chunk(0.25))).toBeCloseTo(0.25, 6)
    expect(chunkLevel(new Float32Array(0))).toBe(0)
  })

  it('passes the room straight through while the speakers are quiet', () => {
    const gate = createEchoGate()
    expect(feed(gate, VOICE, 5)).toEqual(Array(5).fill('pass'))
    expect(feed(gate, QUIET, 3)).toEqual(Array(3).fill('pass'))
  })

  it('suppresses our own translation coming back through the microphone', () => {
    const gate = createEchoGate()
    feed(gate, QUIET, 3)
    gate.setSpeaking(true)
    expect(feed(gate, ECHO, 20)).toEqual(Array(20).fill('suppress'))
  })

  it('suppresses loud playback too, because it is measured not assumed', () => {
    // Echo cancellation defeated: external speakers, turned up. A fixed
    // threshold would call this a person; a threshold measured against what
    // this playback actually sounds like does not.
    const gate = createEchoGate()
    gate.setSpeaking(true)
    expect(feed(gate, LOUD_ECHO, 30)).toEqual(Array(30).fill('suppress'))
  })

  it('calls sustained speech over the translation an interruption', () => {
    const gate = createEchoGate()
    gate.setSpeaking(true)
    feed(gate, ECHO, 6)

    const decisions = feed(gate, VOICE, DEFAULT_ECHO_GATE_OPTIONS.triggerChunks)
    expect(decisions.at(-1)).toBe('barge-in')
    // Everything before the decision was held rather than sent.
    expect(decisions.slice(0, -1)).toEqual(
      Array(DEFAULT_ECHO_GATE_OPTIONS.triggerChunks - 1).fill('suppress'),
    )
  })

  it('does not call one loud moment an interruption', () => {
    const gate = createEchoGate()
    gate.setSpeaking(true)
    feed(gate, ECHO, 6)

    // A syllable of echo that slipped past the canceller, then quiet again.
    expect(feed(gate, VOICE, 1)).toEqual(['suppress'])
    expect(feed(gate, ECHO, 5)).toEqual(Array(5).fill('suppress'))
    // The count started over, so the next single spike is not an interruption.
    expect(feed(gate, VOICE, 1)).toEqual(['suppress'])
  })

  it('hands back the words it was holding when it interrupts', () => {
    const gate = createEchoGate()
    gate.setSpeaking(true)
    feed(gate, ECHO, 4)
    feed(gate, VOICE, DEFAULT_ECHO_GATE_OPTIONS.triggerChunks)

    const held = gate.takePrebuffer()
    // The chunks that made the decision are returned, and only those, so the
    // first word of the interruption is sent rather than swallowed by the
    // measurement — and no residue of our own speakers goes with it.
    expect(held.length).toBe(DEFAULT_ECHO_GATE_OPTIONS.triggerChunks)
    for (const samples of held) {
      expect(chunkLevel(samples)).toBeCloseTo(VOICE, 6)
    }
    expect(gate.takePrebuffer()).toEqual([])
  })

  it('measures each stretch of playback on its own', () => {
    const gate = createEchoGate()
    gate.setSpeaking(true)
    feed(gate, LOUD_ECHO, 10)
    gate.setSpeaking(false)

    // A quieter translation next time: what was too quiet to be a person
    // against loud speakers is loud enough against quiet ones.
    gate.setSpeaking(true)
    feed(gate, ECHO, 4)
    expect(feed(gate, LOUD_ECHO, 2).at(-1)).toBe('barge-in')
  })

  it('hears somebody who was already talking as soon as they draw breath', () => {
    // The stated limit of measuring one microphone: a voice at full volume in
    // the very first chunk of a translation is measured as part of what that
    // translation sounds like, and does not interrupt it. Nothing in the
    // browser can separate the two at that instant.
    const gate = createEchoGate()
    gate.setSpeaking(true)
    expect(feed(gate, VOICE, 8)).not.toContain('barge-in')

    // It resolves itself: the floor is re-measured continuously, so one
    // ordinary gap between words drops it back to the room.
    feed(gate, ECHO, 1)
    expect(feed(gate, VOICE, 2).at(-1)).toBe('barge-in')
  })

  it('forgets everything on reset', () => {
    const gate = createEchoGate()
    gate.setSpeaking(true)
    feed(gate, LOUD_ECHO, 6)
    gate.reset()

    // Back to listening: the room goes out untouched.
    expect(feed(gate, VOICE, 2)).toEqual(['pass', 'pass'])
    expect(gate.takePrebuffer()).toEqual([])
  })
})
