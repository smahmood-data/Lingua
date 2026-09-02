import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackScheduler } from './playbackScheduler'

/** Longer than any grace the scheduler keeps between bursts of one stream. */
const PAST_STREAM_IDLE_MS = 2000

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

  /** Advance the audio clock past everything scheduled so far. */
  playOut() {
    let end = 0
    for (const source of this.sources) {
      end = Math.max(end, (source.startedAt ?? 0) + (source.buffer?.duration ?? 0))
    }
    this.currentTime = end
  }
}

const NativeAudioContext = globalThis.AudioContext

/** `seconds` of audible PCM16 at 24 kHz. */
const chunk = (seconds = 1) => {
  const bytes = new Uint8Array(Math.round(24_000 * 2 * seconds))
  const view = new DataView(bytes.buffer)
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    view.setInt16(offset, offset % 4 === 0 ? 4_000 : -4_000, true)
  }
  return bytes
}

/** `seconds` of the digital padding returned by a continuous translation. */
const padding = (seconds = 0.25) =>
  new Uint8Array(Math.round(24_000 * 2 * seconds))

async function scheduler() {
  const onPlaybackStart = vi.fn()
  const onPlaybackEnd = vi.fn()
  const playback = await createPlaybackScheduler({
    sampleRate: 24_000,
    onPlaybackStart,
    onPlaybackEnd,
  })
  const context = FakeAudioContext.instances.at(-1)!
  return { playback, context, onPlaybackStart, onPlaybackEnd }
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

  describe('Test F — streaming audio', () => {
    it('schedules chunks back to back with no gap of its own', async () => {
      const { playback, context } = await scheduler()

      playback.enqueue(chunk(0.5))
      playback.enqueue(chunk(0.5))
      playback.enqueue(chunk(0.5))

      const [first, second, third] = context.sources
      expect(first.startedAt).toBeGreaterThan(0)
      expect(second.startedAt).toBeCloseTo(first.startedAt! + 0.5, 6)
      expect(third.startedAt).toBeCloseTo(second.startedAt! + 0.5, 6)
    })

    it('keeps chunks in order when the clock has moved on between them', async () => {
      const { playback, context } = await scheduler()

      playback.enqueue(chunk(0.5))
      context.currentTime = 0.3
      playback.enqueue(chunk(0.5))

      const [first, second] = context.sources
      expect(second.startedAt).toBeCloseTo(first.startedAt! + 0.5, 6)
    })

    it('announces a start once for a whole stream', async () => {
      const { playback, onPlaybackStart } = await scheduler()

      playback.enqueue(chunk(0.5))
      playback.enqueue(chunk(0.5))
      playback.enqueue(chunk(0.5))

      expect(onPlaybackStart).toHaveBeenCalledOnce()
    })

    it('does not end a stream during a gap between two bursts', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(0.2))
      context.playOut()
      context.sources[0].end()
      // A burst boundary: the queue is momentarily empty but the sentence is
      // not over. Ending here is what used to reopen the microphone into the
      // translation that was still playing.
      await vi.advanceTimersByTimeAsync(400)
      expect(onPlaybackEnd).not.toHaveBeenCalled()

      playback.enqueue(chunk(0.2))
      expect(onPlaybackEnd).not.toHaveBeenCalled()
    })
  })

  describe('Test G — deterministic end of a normal stream', () => {
    it('keeps an end signal that arrives before the final audio chunk', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      // This is the browser ordering that previously lost the normal boundary:
      // the coordinator learned generation was complete while route arbitration
      // was still holding its first audio chunk.
      playback.endStream()
      playback.enqueue(chunk(0.2))
      context.playOut()
      context.sources[0].end()
      await vi.advanceTimersByTimeAsync(10)

      expect(onPlaybackEnd).toHaveBeenCalledOnce()
    })

    it('ends when the audio clock reaches the end of the last chunk', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(1))
      playback.endStream()
      expect(onPlaybackEnd).not.toHaveBeenCalled()

      // Still audible: the clock has not reached the end of the buffer.
      await vi.advanceTimersByTimeAsync(500)
      expect(onPlaybackEnd).not.toHaveBeenCalled()

      context.playOut()
      context.sources[0].end()
      await vi.advanceTimersByTimeAsync(10)
      expect(onPlaybackEnd).toHaveBeenCalledOnce()
    })

    it('ends on the audio clock alone when onended is never delivered', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(1))
      playback.endStream()
      context.playOut()
      await vi.advanceTimersByTimeAsync(1200)

      expect(onPlaybackEnd).toHaveBeenCalledOnce()
      expect(context.sources[0].disconnect).toHaveBeenCalledOnce()
    })

    it('keeps playing when more audio arrives after an end signal', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(0.2))
      playback.endStream()
      playback.enqueue(chunk(0.2))
      context.currentTime = 0.3
      await vi.advanceTimersByTimeAsync(200)
      expect(onPlaybackEnd).not.toHaveBeenCalled()

      context.playOut()
      await vi.advanceTimersByTimeAsync(PAST_STREAM_IDLE_MS)
      expect(onPlaybackEnd).toHaveBeenCalledOnce()
    })

    it('does not let continuous silent padding extend a completed stream', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(0.25))
      playback.endStream()
      for (let index = 0; index < 51; index += 1) {
        playback.enqueue(padding())
      }

      // One audible chunk plus at most 750 ms of preserved output-side pause.
      expect(playback.remainingMs()).toBeLessThanOrEqual(1_120)
      expect(context.sources).toHaveLength(4)

      context.playOut()
      await vi.advanceTimersByTimeAsync(1_300)
      expect(onPlaybackEnd).toHaveBeenCalledOnce()
    })

    it('preserves a short silent pause when audible speech resumes', async () => {
      const { playback, context } = await scheduler()

      playback.enqueue(chunk(0.25))
      playback.enqueue(padding(0.5))
      playback.enqueue(chunk(0.25))

      expect(context.sources).toHaveLength(3)
      expect(context.sources[2].startedAt).toBeCloseTo(
        context.sources[1].startedAt! + 0.5,
        6,
      )
    })
  })

  describe('Test H — recovery when the end signal is lost', () => {
    it('ends the stream after an idle period with no end signal', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(0.2))
      context.playOut()
      context.sources[0].end()
      // No endStream(): model a lost generationComplete.
      await vi.advanceTimersByTimeAsync(600)
      expect(onPlaybackEnd).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(PAST_STREAM_IDLE_MS)
      expect(onPlaybackEnd).toHaveBeenCalledOnce()
    })

    it('pairs exactly one end with each start', async () => {
      const { playback, context, onPlaybackStart, onPlaybackEnd } =
        await scheduler()

      playback.enqueue(chunk(0.2))
      playback.endStream()
      context.playOut()
      await vi.advanceTimersByTimeAsync(PAST_STREAM_IDLE_MS)
      expect(onPlaybackStart).toHaveBeenCalledOnce()
      expect(onPlaybackEnd).toHaveBeenCalledOnce()

      playback.enqueue(chunk(0.2))
      expect(onPlaybackStart).toHaveBeenCalledTimes(2)
      playback.endStream()
      context.playOut()
      await vi.advanceTimersByTimeAsync(PAST_STREAM_IDLE_MS)
      expect(onPlaybackEnd).toHaveBeenCalledTimes(2)
    })
  })

  describe('a stalled output device', () => {
    it('ends the stream when the audio clock stops advancing', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(3))
      playback.endStream()
      // The clock freezes: the browser suspended or interrupted the context,
      // which an output device changing under the page is enough to do. Waiting
      // on it is waiting forever, and the microphone is silenced for exactly
      // that long.
      await vi.advanceTimersByTimeAsync(30_000)

      expect(onPlaybackEnd).toHaveBeenCalledOnce()
      expect(context.sources[0].stop).toHaveBeenCalledOnce()
    })

    it('keeps playing while the clock is merely slow', async () => {
      const { playback, context, onPlaybackEnd } = await scheduler()

      playback.enqueue(chunk(3))
      playback.endStream()
      for (let step = 0; step < 6; step += 1) {
        context.currentTime += 0.5
        await vi.advanceTimersByTimeAsync(500)
      }
      expect(onPlaybackEnd).not.toHaveBeenCalled()

      context.playOut()
      await vi.advanceTimersByTimeAsync(100)
      expect(onPlaybackEnd).toHaveBeenCalledOnce()
    })
  })

  it('flushes a queue that is still playing and reports the end', async () => {
    const { playback, context, onPlaybackEnd } = await scheduler()

    playback.enqueue(chunk(1))
    playback.enqueue(chunk(1))
    playback.flush()

    expect(context.sources[0].stop).toHaveBeenCalledOnce()
    expect(context.sources[1].stop).toHaveBeenCalledOnce()
    expect(onPlaybackEnd).toHaveBeenCalledOnce()
  })

  it('reports no end for a flush that never started anything', async () => {
    const { playback, onPlaybackEnd } = await scheduler()

    playback.flush()
    expect(onPlaybackEnd).not.toHaveBeenCalled()
  })

  it('restarts the schedule after a flush rather than resuming a stale clock', async () => {
    const { playback, context } = await scheduler()

    playback.enqueue(chunk(1))
    playback.flush()
    context.currentTime = 0.4
    playback.enqueue(chunk(1))

    expect(context.sources[1].startedAt).toBeGreaterThanOrEqual(0.4)
    expect(context.sources[1].startedAt).toBeLessThan(1)
  })

  it('refuses audio once disposed and reports remaining time as zero', async () => {
    const { playback, onPlaybackEnd } = await scheduler()

    playback.enqueue(chunk(1))
    await playback.dispose()

    expect(onPlaybackEnd).toHaveBeenCalledOnce()
    expect(playback.enqueue(chunk(1))).toBe(false)
    expect(playback.remainingMs()).toBe(0)
    await expect(playback.dispose()).resolves.toBeUndefined()
  })

  it('ignores an empty chunk', async () => {
    const { playback, context, onPlaybackStart } = await scheduler()

    expect(playback.enqueue(new Uint8Array(0))).toBe(false)
    expect(context.sources).toHaveLength(0)
    expect(onPlaybackStart).not.toHaveBeenCalled()
  })

  it('does not announce playback for leading digital padding', async () => {
    const { playback, context, onPlaybackStart } = await scheduler()

    expect(playback.enqueue(padding())).toBe(false)
    expect(context.sources).toHaveLength(0)
    expect(onPlaybackStart).not.toHaveBeenCalled()
  })

  it('closes the AudioContext when resuming it fails', async () => {
    class FailingContext extends FakeAudioContext {
      override state: 'running' | 'closed' = 'running'
      override resume = vi.fn(async () => {
        throw new Error('no output device')
      })
      createGainThrows = true
      override createGain(): never {
        throw new Error('no output device')
      }
    }
    globalThis.AudioContext = FailingContext as unknown as typeof AudioContext

    await expect(
      createPlaybackScheduler({ sampleRate: 24_000 }),
    ).rejects.toMatchObject({ code: 'unsupported-browser' })
    const context = FakeAudioContext.instances.at(-1)!
    expect(context.close).toHaveBeenCalledOnce()
  })
})
