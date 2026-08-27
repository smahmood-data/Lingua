/**
 * Pure audio conversion helpers.
 *
 * Deliberately free of browser APIs (no AudioContext, no MediaStream) so the
 * conversion maths can be unit tested directly — see Issue #6.
 */

/** Clamp a float sample to [-1, 1] and scale it to a signed 16-bit integer. */
export function floatToPcm16Sample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

/**
 * Resample with linear interpolation.
 *
 * The capture AudioContext is created at the target rate, so in practice this is
 * a no-op passthrough. It exists as a correctness fallback for browsers that do
 * not honour the requested context sample rate.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate || input.length === 0) {
    return input
  }
  if (inputRate <= 0 || outputRate <= 0) {
    throw new RangeError('Sample rates must be positive')
  }

  const ratio = inputRate / outputRate
  const outputLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio
    const lowerIndex = Math.floor(position)
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1)
    const weight = position - lowerIndex
    output[i] = input[lowerIndex] * (1 - weight) + input[upperIndex] * weight
  }

  return output
}

/** Encode float samples as little-endian PCM16 bytes. */
export function floatToPcm16Bytes(input: Float32Array): Uint8Array {
  const bytes = new Uint8Array(input.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < input.length; i += 1) {
    view.setInt16(i * 2, floatToPcm16Sample(input[i]), true)
  }
  return bytes
}

/**
 * Decode little-endian PCM16 bytes back into normalised float samples.
 *
 * The explicit `ArrayBuffer` argument keeps the result assignable to Web Audio
 * APIs such as `AudioBuffer.copyToChannel`, which reject shared buffers.
 */
export function pcm16BytesToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const output = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i += 1) {
    output[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return output
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked so a long buffer cannot blow the argument limit of String.fromCharCode.
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Turn one captured buffer into the base64 PCM16 payload the Live API expects.
 */
export function encodeCaptureChunk(
  samples: Float32Array,
  inputRate: number,
  outputRate: number,
): string {
  const resampled = resampleLinear(samples, inputRate, outputRate)
  return bytesToBase64(floatToPcm16Bytes(resampled))
}
