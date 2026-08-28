import { isSessionError, sessionError } from '../errors'
import { pcm16BytesToFloat } from './pcm'

/** Head start given to the first chunk so it is never scheduled in the past. */
const SCHEDULE_LEAD_SECONDS = 0.06

/**
 * Grace period before reporting that playback has drained. Gemini streams audio
 * in bursts, so a short gap between chunks is not the end of a turn.
 */
const DRAIN_GRACE_MS = 150

export interface PlaybackSchedulerOptions {
  /** Sample rate of the incoming PCM16 stream. */
  sampleRate: number
  /** Fired when playback starts after being idle. */
  onPlaybackStart?: () => void
  /** Fired once the scheduled queue has emptied. */
  onPlaybackDrained?: () => void
}

export interface PlaybackScheduler {
  /** Queue one little-endian PCM16 chunk for gap-free, in-order playback. */
  enqueue: (pcm16: Uint8Array) => void
  /** Drop everything queued or already scheduled, e.g. on an interruption. */
  flush: () => void
  /**
   * Audio-clock time left before the queue runs dry, in milliseconds.
   *
   * Read from the same clock the chunks were scheduled on, so a caller that
   * has to bound how long playback may last does not have to guess.
   */
  remainingMs: () => number
  /** Idempotent teardown of the queue and the AudioContext. */
  dispose: () => Promise<void>
}

/**
 * Schedule streamed PCM chunks back to back on the Web Audio clock.
 *
 * Each chunk is appended at `nextStartTime` rather than at "now", which keeps
 * chunks in order and prevents them from overlapping when several arrive at once.
 */
export async function createPlaybackScheduler(
  options: PlaybackSchedulerOptions,
): Promise<PlaybackScheduler> {
  const audioContext = new AudioContext({ sampleRate: options.sampleRate })

  let output: GainNode
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    output = audioContext.createGain()
    output.connect(audioContext.destination)
  } catch (cause) {
    // resume() and node creation can both reject. Without this the context
    // stays open for the lifetime of the page after a failed start.
    if (audioContext.state !== 'closed') {
      await audioContext.close().catch(() => undefined)
    }
    throw isSessionError(cause) ? cause : sessionError('unsupported-browser')
  }

  const activeSources = new Set<AudioBufferSourceNode>()
  let nextStartTime = 0
  let drainTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  /**
   * Whether a start has been announced that has not been paired with a drain.
   *
   * The caller silences the microphone between those two callbacks, so a start
   * that never drains leaves it deaf. Tracking the announcement rather than the
   * queue is what makes the pair impossible to break: the queue can already be
   * empty when a flush arrives, and reading it would skip the drain.
   */
  let announcedStart = false

  const clearDrainTimer = () => {
    if (drainTimer !== null) {
      clearTimeout(drainTimer)
      drainTimer = null
    }
  }

  /** Announce the drain exactly once per announced start. */
  const announceDrain = () => {
    if (!announcedStart) return
    announcedStart = false
    nextStartTime = 0
    if (!disposed) {
      options.onPlaybackDrained?.()
    }
  }

  const scheduleDrainCheck = () => {
    clearDrainTimer()
    drainTimer = setTimeout(() => {
      drainTimer = null
      if (activeSources.size === 0) {
        announceDrain()
      }
    }, DRAIN_GRACE_MS)
  }

  const releaseSource = (source: AudioBufferSourceNode) => {
    source.onended = null
    source.disconnect()
    activeSources.delete(source)
  }

  const enqueue = (pcm16: Uint8Array) => {
    if (disposed || pcm16.byteLength < 2) {
      return
    }

    const samples = pcm16BytesToFloat(pcm16)
    const buffer = audioContext.createBuffer(1, samples.length, options.sampleRate)
    buffer.copyToChannel(samples, 0)

    const wasIdle = activeSources.size === 0
    clearDrainTimer()

    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    source.onended = () => {
      releaseSource(source)
      if (activeSources.size === 0) {
        scheduleDrainCheck()
      }
    }

    const startAt = Math.max(
      audioContext.currentTime + SCHEDULE_LEAD_SECONDS,
      nextStartTime,
    )
    source.start(startAt)
    nextStartTime = startAt + buffer.duration
    activeSources.add(source)

    if (wasIdle && !announcedStart) {
      announcedStart = true
      options.onPlaybackStart?.()
    }
  }

  const remainingMs = () =>
    Math.max(0, (nextStartTime - audioContext.currentTime) * 1000)

  const flush = () => {
    clearDrainTimer()

    for (const source of [...activeSources]) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // Stopping a source that has not started yet throws in some browsers.
        // It is disconnected below either way.
      }
      releaseSource(source)
    }

    // Unconditional: a flush that lands in the grace period after the last
    // chunk ended finds an empty queue, and skipping the drain there is what
    // used to strand the caller in its playing state with a dead microphone.
    announceDrain()
  }

  const dispose = async () => {
    if (disposed) {
      return
    }
    flush()
    disposed = true
    output.disconnect()

    if (audioContext.state !== 'closed') {
      try {
        await audioContext.close()
      } catch {
        // Already closing; the queue is empty and the nodes are disconnected.
      }
    }
  }

  return { enqueue, flush, remainingMs, dispose }
}
