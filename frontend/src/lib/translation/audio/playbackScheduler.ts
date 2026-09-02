import { isSessionError, sessionError } from '../errors'
import { liveTrace } from '../debug'
import { pcm16BytesToFloat } from './pcm'

/**
 * Jitter lead given to the first chunk of a stream.
 *
 * Gemini delivers PCM in bursts, so a chunk can be late relative to the one
 * before it. Starting slightly ahead of the audio clock gives later chunks a
 * cushion to land in without the stream running dry mid-sentence. Small enough
 * that it is not heard as latency.
 */
const SCHEDULE_LEAD_SECONDS = 0.12

/** Margin added to an audio-clock deadline before it is re-checked. */
const CLOCK_SLACK_MS = 40

/**
 * How long a stream may go without new audio before it is treated as over.
 *
 * Purely a failure fallback. A healthy turn ends because the owning route said
 * it had produced its last chunk and the audio clock then reached the end of
 * it; this only covers that signal never arriving.
 */
const STREAM_IDLE_MS = 1500

/**
 * How long the audio clock may fail to advance before the output is treated as
 * dead.
 *
 * `currentTime` stops moving when the browser suspends or interrupts an
 * AudioContext — an output device changing under the page is enough. Waiting on
 * a clock that has stopped is waiting forever: the session stays on "playing
 * the translation" and, because the microphone is silenced for exactly that
 * long, never hears anybody again. Nothing about the audio clock can detect
 * this, so the wall clock has to.
 */
const STALL_TIMEOUT_MS = 1500

/**
 * Most silence between spoken words that is allowed to occupy the output queue.
 *
 * Live Translate is a continuous stream and can keep returning PCM padding after
 * its audible speech is over. Keeping a short pause preserves the voice's
 * cadence; scheduling an unbounded run of zeroes makes an inaudible stream keep
 * the product in Playing forever. This is measured in samples from the returned
 * audio itself, not as a wall-clock completion timeout.
 */
const MAX_SCHEDULED_SILENCE_SECONDS = 0.75

/** PCM16 peak at or below which a chunk is effectively digital silence. */
const SILENT_PCM16_PEAK = 8

export interface PlaybackSchedulerOptions {
  /** Sample rate of the incoming PCM16 stream. */
  sampleRate: number
  /** Fired when audio starts after the scheduler was idle. */
  onPlaybackStart?: () => void
  /** Fired once every scheduled chunk has physically finished playing. */
  onPlaybackEnd?: () => void
}

export interface PlaybackScheduler {
  /** Queue audible PCM for gapless playback. False if no sample was scheduled. */
  enqueue: (pcm16: Uint8Array) => boolean
  /**
   * No more audio is coming for the stream being played.
   *
   * The end callback then fires exactly when the audio clock reaches the end of
   * what is already scheduled — the deterministic end of a normal turn.
   */
  endStream: () => void
  /** Drop everything queued or playing, e.g. on an interruption. */
  flush: () => void
  /** Audio-clock time left before the queue runs dry, in milliseconds. */
  remainingMs: () => number
  /** Idempotent teardown of the queue and the AudioContext. */
  dispose: () => Promise<void>
}

/**
 * Schedule streamed PCM chunks back to back on the Web Audio clock.
 *
 * Each chunk is appended at `nextStartTime` rather than at "now", so chunks
 * play in order and gaplessly however they arrive. The scheduler reports only
 * two things — audio started, audio finished — and it reports the second one
 * from the audio clock, never from a guess about how long a silence means the
 * turn is over. A gap between two bursts of one sentence is not the end of it,
 * and announcing that it was is what let the microphone reopen while the
 * translation was still coming out of the speakers.
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
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  /** A start has been announced that has not been paired with an end yet. */
  let playing = false
  /** The producer has said it has no more audio for this stream. */
  let streamEnded = false
  let lastEnqueueAt = 0
  /** Audio-clock reading, and the wall time it was taken, at the last check. */
  let lastClock = 0
  let lastClockAt = 0
  let scheduledSilenceSamples = 0
  let streamCounter = 0
  let streamId = 0
  const maxScheduledSilenceSamples = Math.round(
    options.sampleRate * MAX_SCHEDULED_SILENCE_SECONDS,
  )

  const remainingMs = () =>
    Math.max(0, (nextStartTime - audioContext.currentTime) * 1000)

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (delayMs: number) => {
    clearTimer()
    timer = setTimeout(tick, Math.max(0, delayMs))
  }

  /**
   * Wake up when the queue is due to run dry, or sooner to check the clock is
   * still moving. Capping the wait is what keeps a stall on a long stream from
   * going unnoticed until the whole stream would have finished.
   */
  const armClockCheck = () => {
    schedule(Math.min(remainingMs(), STALL_TIMEOUT_MS) + CLOCK_SLACK_MS)
  }

  const releaseSource = (source: AudioBufferSourceNode) => {
    source.onended = null
    try {
      source.disconnect()
    } catch {
      // The node is already at the end of its one-shot lifetime. Some Web Audio
      // implementations reject a redundant disconnect during teardown.
    } finally {
      // A disconnect failure must not strand a source in lifecycle state after
      // the browser has already finished playing it.
      activeSources.delete(source)
    }
  }

  const announceEnd = () => {
    const endedStream = streamId
    const endedAt = nextStartTime
    clearTimer()
    streamEnded = false
    nextStartTime = 0
    lastClockAt = 0
    scheduledSilenceSamples = 0
    for (const source of [...activeSources]) releaseSource(source)
    if (!playing) return
    playing = false
    liveTrace('playback-physical-end', {
      stream: endedStream,
      scheduledEndMs: Math.round(endedAt * 1000),
      contextTimeMs: Math.round(audioContext.currentTime * 1000),
    })
    if (!disposed) options.onPlaybackEnd?.()
  }

  /**
   * Decide, off the audio clock, whether the stream is over.
   *
   * Wall-clock timers keep running while an AudioContext is suspended, so the
   * clock is the only thing that can say playback physically reached the end of
   * what was scheduled.
   */
  function tick() {
    timer = null
    const left = remainingMs()
    if (left > 0) {
      const now = Date.now()
      const clock = audioContext.currentTime
      if (clock > lastClock || lastClockAt === 0) {
        lastClock = clock
        lastClockAt = now
      } else if (now - lastClockAt >= STALL_TIMEOUT_MS) {
        // The clock has stopped while audio was still due. Nothing is coming
        // out of the speakers, so the stream is over whatever it says.
        stop()
        announceEnd()
        return
      }
      armClockCheck()
      return
    }
    if (streamEnded) {
      announceEnd()
      return
    }
    const idleFor = Date.now() - lastEnqueueAt
    if (idleFor >= STREAM_IDLE_MS) {
      announceEnd()
      return
    }
    schedule(STREAM_IDLE_MS - idleFor)
  }

  const enqueue = (pcm16: Uint8Array) => {
    if (disposed || pcm16.byteLength < 2) {
      return false
    }

    const samples = pcm16BytesToFloat(pcm16)
    let peak = 0
    for (const sample of samples) {
      peak = Math.max(peak, Math.round(Math.abs(sample) * 0x8000))
    }
    const silent = peak <= SILENT_PCM16_PEAK

    // Leading padding is not playback. Once speech exists, retain a bounded
    // amount so ordinary pauses keep their cadence, then stop extending the
    // physical queue. The already-armed clock check remains authoritative for
    // the final scheduled sample.
    if (silent && !playing) {
      liveTrace('playback-padding-drop', {
        stream: null,
        bytes: pcm16.byteLength,
        peak,
        reason: 'leading',
      })
      return false
    }

    let scheduled = samples
    if (silent) {
      const available = maxScheduledSilenceSamples - scheduledSilenceSamples
      if (available <= 0) {
        liveTrace('playback-padding-drop', {
          stream: streamId,
          bytes: pcm16.byteLength,
          peak,
          reason: 'trailing-cap',
          scheduledSilenceMs: Math.round(
            (scheduledSilenceSamples / options.sampleRate) * 1000,
          ),
          producerEnded: streamEnded,
          scheduledEndMs: Math.round(nextStartTime * 1000),
          contextTimeMs: Math.round(audioContext.currentTime * 1000),
        })
        return false
      }
      if (scheduled.length > available) scheduled = scheduled.slice(0, available)
      scheduledSilenceSamples += scheduled.length
    } else {
      scheduledSilenceSamples = 0
    }

    const buffer = audioContext.createBuffer(
      1,
      scheduled.length,
      options.sampleRate,
    )
    buffer.copyToChannel(scheduled, 0)

    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    source.onended = () => {
      releaseSource(source)
      // Physical proof that everything scheduled so far has played. `tick`
      // decides what that means; it is the only place that does.
      if (activeSources.size === 0) schedule(0)
    }

    const startAt = Math.max(
      audioContext.currentTime + SCHEDULE_LEAD_SECONDS,
      nextStartTime,
    )
    source.start(startAt)
    nextStartTime = startAt + buffer.duration
    activeSources.add(source)
    lastClock = audioContext.currentTime
    lastClockAt = Date.now()
    // A producer boundary remains authoritative if a trailing chunk reaches us
    // after it. Clearing it here made `generationComplete -> final audio` lose
    // the only normal end signal and left playback dependent on the idle
    // fallback (or a much later server `turnComplete`). The deadline below is
    // re-armed to the new physical end, so all trailing audio still plays.
    lastEnqueueAt = Date.now()
    armClockCheck()

    if (!playing) {
      playing = true
      streamId = (streamCounter += 1)
      liveTrace('playback-stream-start', {
        stream: streamId,
        contextTimeMs: Math.round(audioContext.currentTime * 1000),
      })
      options.onPlaybackStart?.()
    }
    liveTrace('playback-schedule', {
      stream: streamId,
      bytes: pcm16.byteLength,
      samples: scheduled.length,
      peak,
      silent,
      producerEnded: streamEnded,
      activeSources: activeSources.size,
      scheduledEndMs: Math.round(nextStartTime * 1000),
      contextTimeMs: Math.round(audioContext.currentTime * 1000),
    })
    return true
  }

  const endStream = () => {
    if (disposed) return
    streamEnded = true
    liveTrace('playback-producer-end', {
      stream: playing ? streamId : null,
      activeSources: activeSources.size,
      scheduledEndMs: Math.round(nextStartTime * 1000),
      contextTimeMs: Math.round(audioContext.currentTime * 1000),
    })
    armClockCheck()
  }

  /** Silence every scheduled source without announcing anything. */
  const stop = () => {
    for (const source of [...activeSources]) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // Stopping a source that has not started yet throws in some browsers.
        // It is disconnected by releaseSource either way.
      }
      releaseSource(source)
    }
  }

  const flush = () => {
    stop()
    announceEnd()
  }

  const dispose = async () => {
    if (disposed) {
      return
    }
    flush()
    disposed = true
    clearTimer()
    output.disconnect()

    if (audioContext.state !== 'closed') {
      try {
        await audioContext.close()
      } catch {
        // Already closing; the queue is empty and the nodes are disconnected.
      }
    }
  }

  return { enqueue, endStream, flush, remainingMs, dispose }
}
