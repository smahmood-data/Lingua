/**
 * Source for the microphone capture AudioWorklet.
 *
 * The processor is kept as a string and loaded from a blob URL so the worklet
 * ships with the module graph instead of depending on a separate static asset,
 * which behaves identically in `vite dev` and in a production build.
 *
 * It buffers the 128-frame render quanta into fixed-size chunks and transfers
 * them to the main thread, so no audio conversion happens on the audio thread.
 */
export const CAPTURE_PROCESSOR_NAME = 'lingua-capture-processor'

const CAPTURE_PROCESSOR_SOURCE = `
class LinguaCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.chunkFrames = options.processorOptions.chunkFrames
    this.buffer = new Float32Array(this.chunkFrames)
    this.offset = 0
    this.stopped = false
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.stopped = true
      }
    }
  }

  process(inputs) {
    if (this.stopped) {
      return false
    }

    const channel = inputs[0] && inputs[0][0]
    if (!channel) {
      return true
    }

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.offset] = channel[i]
      this.offset += 1

      if (this.offset === this.chunkFrames) {
        const chunk = this.buffer.slice(0)
        this.port.postMessage(chunk, [chunk.buffer])
        this.offset = 0
      }
    }

    return true
  }
}

registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR_NAME)}, LinguaCaptureProcessor)
`

/** Create a blob URL for the processor. Callers must revoke it after loading. */
export function createCaptureWorkletUrl(): string {
  return URL.createObjectURL(
    new Blob([CAPTURE_PROCESSOR_SOURCE], { type: 'application/javascript' }),
  )
}
