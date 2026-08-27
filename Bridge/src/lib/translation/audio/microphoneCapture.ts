import { isSessionError, microphoneError, sessionError } from '../errors'
import { CAPTURE_PROCESSOR_NAME, createCaptureWorkletUrl } from './captureWorklet'

export interface MicrophoneCaptureOptions {
  /** Sample rate requested from the capture AudioContext. */
  targetSampleRate: number
  /** Length of each chunk handed to `onChunk`, in milliseconds. */
  chunkMs: number
  /** Called on the main thread with raw float samples at `capture.sampleRate`. */
  onChunk: (samples: Float32Array, sampleRate: number) => void
}

export interface MicrophoneCapture {
  /** Rate the browser actually gave us, which may differ from the request. */
  readonly sampleRate: number
  /** Idempotent teardown: worklet, graph nodes, media tracks, AudioContext. */
  stop: () => Promise<void>
}

/** Throw a clear error before touching hardware if the browser cannot do this. */
export function assertAudioCaptureSupport(): void {
  const hasMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  const hasAudioContext = typeof window !== 'undefined' && 'AudioContext' in window
  const hasWorklet = typeof window !== 'undefined' && 'AudioWorkletNode' in window

  if (!hasMedia || !hasAudioContext || !hasWorklet) {
    throw sessionError('unsupported-browser')
  }
}

/**
 * Open the microphone and stream fixed-size float chunks to `onChunk`.
 *
 * Any failure during setup tears down whatever was already created, so a failed
 * start never leaves a live media track behind.
 */
export async function startMicrophoneCapture(
  options: MicrophoneCaptureOptions,
): Promise<MicrophoneCapture> {
  assertAudioCaptureSupport()

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Echo cancellation matters here: on a single laptop the translated
        // audio comes out of the same speakers the microphone is listening to.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
  } catch (cause) {
    throw microphoneError(cause)
  }

  let audioContext: AudioContext | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let workletNode: AudioWorkletNode | null = null
  let sinkNode: GainNode | null = null
  let stopped = false

  const releaseTracks = () => {
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  const stop = async () => {
    if (stopped) {
      return
    }
    stopped = true

    if (workletNode) {
      // Detach first so a chunk that is already in flight cannot reach onChunk.
      workletNode.port.onmessage = null
      workletNode.port.postMessage('stop')
      workletNode.port.close()
      workletNode.disconnect()
    }
    sourceNode?.disconnect()
    sinkNode?.disconnect()
    releaseTracks()

    if (audioContext && audioContext.state !== 'closed') {
      try {
        await audioContext.close()
      } catch {
        // An AudioContext that is already closing throws; the tracks are
        // released either way, so there is nothing further to recover.
      }
    }

    workletNode = null
    sourceNode = null
    sinkNode = null
    audioContext = null
  }

  try {
    audioContext = new AudioContext({ sampleRate: options.targetSampleRate })
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    const workletUrl = createCaptureWorkletUrl()
    try {
      await audioContext.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    const sampleRate = audioContext.sampleRate
    const chunkFrames = Math.max(
      128,
      Math.round((sampleRate * options.chunkMs) / 1000),
    )

    sourceNode = audioContext.createMediaStreamSource(stream)
    workletNode = new AudioWorkletNode(audioContext, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { chunkFrames },
    })

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!stopped) {
        options.onChunk(event.data, sampleRate)
      }
    }

    // The worklet writes no output. Routing it through a silent gain node keeps
    // the graph active in every browser without making the microphone audible.
    sinkNode = audioContext.createGain()
    sinkNode.gain.value = 0

    sourceNode.connect(workletNode)
    workletNode.connect(sinkNode)
    sinkNode.connect(audioContext.destination)

    return { sampleRate, stop }
  } catch (cause) {
    await stop()
    if (isSessionError(cause)) {
      throw cause
    }
    // The permission prompt already succeeded, so this is the audio stack
    // failing rather than a denial: an unsupported sample rate, or a worklet
    // that could not be loaded.
    throw sessionError('unsupported-browser')
  }
}
