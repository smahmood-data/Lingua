import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackScheduler } from './playbackScheduler'

/** Longer than the scheduler's internal grace period between bursts. */
const PAST_DRAIN_GRACE_MS = 300

class FakeBufferSource {
  buffer: { duration: number } | null = null
  onended: (() => void) | null = null
  startedAt: number | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  stop = vi.fn()

  start(when: number) {
    this.startedAt = when
  }

  /** Play out to completion, the way the Web Audio clock would. */
  end() {
    this.onended?.()
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  state: 'running' | 'closed' = 'running'
  currentTime = 0
  destination = {}
  sources: FakeBufferSource[] = []

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    this.state = 'closed'
  })

  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel: vi.fn() }
  }

  createBufferSource() {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source
  }
}

const NativeAudioContext = globalThis.AudioContext

/** One second of PCM16 at 24 kHz. */
const chunk = () => new Uint8Array(24_000 * 2)

async function scheduler() {
  const onPlaybackStart = vi.fn()
  const onPlaybackDrained = vi.fn()
  const playback = await createPlaybackScheduler({
    sampleRate: 24_000,
    onPlaybackStart,
    onPlaybackDrained,
  })
  const context = FakeAudioContext.instances.at(-1)!
  return { playback, context, onPlaybackStart, onPlaybackDrained }
}

describe('createPlaybackScheduler', () => {
  beforeEach(() => {
    FakeAudioContext.instances = []
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.AudioContext = NativeAudioContext
  })

  it('reports a drain for the start it reported', async () => {
    const { playback, context, onPlaybackStart, onPlaybackDrained } =
      await scheduler()

    playback.enqueue(chunk())
    expect(onPlaybackStart).toHaveBeenCalledOnce()
    expect(onPlaybackDrained).not.toHaveBeenCalled()

    context.sources[0].end()
    await vi.advanceTimersByTimeAsync(PAST_DRAIN_GRACE_MS)
    expect(onPlaybackDrained).toHaveBeenCalledOnce()
  })

  it('reports the drain when a flush lands just after the last chunk ended', async () => {
    const { playback, context, onPlaybackStart, onPlaybackDrained } =
      await scheduler()

    playback.enqueue(chunk())
    context.sources[0].end()
    expect(onPlaybackStart).toHaveBeenCalledOnce()
    expect(onPlaybackDrained).not.toHaveBeenCalled()

    // An interruption arriving inside the grace period finds an empty queue.
    // The caller silences the microphone between start and drain, so skipping
    // the drain here leaves it deaf and the session permanently "playing".
    playback.flush()
    expect(onPlaybackDrained).toHaveBeenCalledOnce()

    // And the drain the grace timer would have reported is not repeated.
    await vi.advanceTimersByTimeAsync(PAST_DRAIN_GRACE_MS)
    expect(onPlaybackDrained).toHaveBeenCalledOnce()
  })

  it('reports the drain when a flush interrupts audio that is still playing', async () => {
    const { playback, onPlaybackDrained } = await scheduler()

    playback.enqueue(chunk())
    playback.flush()

    expect(onPlaybackDrained).toHaveBeenCalledOnce()
  })

  it('does not report a drain it never started', async () => {
    const { playback, onPlaybackStart, onPlaybackDrained } = await scheduler()

    playback.flush()
    await vi.advanceTimersByTimeAsync(PAST_DRAIN_GRACE_MS)

    expect(onPlaybackStart).not.toHaveBeenCalled()
    expect(onPlaybackDrained).not.toHaveBeenCalled()
  })

  it('starts and drains again for the next utterance', async () => {
    const { playback, context, onPlaybackStart, onPlaybackDrained } =
      await scheduler()

    playback.enqueue(chunk())
    context.sources[0].end()
    await vi.advanceTimersByTimeAsync(PAST_DRAIN_GRACE_MS)

    playback.enqueue(chunk())
    expect(onPlaybackStart).toHaveBeenCalledTimes(2)
    context.sources[1].end()
    await vi.advanceTimersByTimeAsync(PAST_DRAIN_GRACE_MS)

    expect(onPlaybackDrained).toHaveBeenCalledTimes(2)
  })

  it('reports how much audio is still queued', async () => {
    const { playback, context } = await scheduler()

    expect(playback.remainingMs()).toBe(0)

    playback.enqueue(chunk())
    playback.enqueue(chunk())
    // Two one-second chunks, scheduled back to back after the start lead.
    expect(playback.remainingMs()).toBeGreaterThan(2000)

    context.currentTime = 2.5
    expect(playback.remainingMs()).toBeLessThan(1000)

    // Once the queue is abandoned there is nothing left to wait for.
    playback.flush()
    expect(playback.remainingMs()).toBe(0)
  })
})
