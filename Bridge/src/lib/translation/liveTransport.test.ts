import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: sdk.connect }
  },
  Modality: { AUDIO: 'AUDIO' },
}))

import { connectLiveTransport } from './liveTransport'

const NativeWebSocket = globalThis.WebSocket

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  close = vi.fn()

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }
}

describe('connectLiveTransport cancellation', () => {
  beforeEach(() => {
    sdk.connect.mockReset()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = NativeWebSocket
  })

  it('closes the SDK socket while its setup handshake is still pending', async () => {
    let resolveLateConnection!: (session: { close: () => void }) => void
    const closeLateSession = vi.fn()
    sdk.connect.mockImplementation(() => {
      new WebSocket('wss://example.test/live')
      return new Promise((resolve) => {
        resolveLateConnection = resolve
      })
    })

    const abortController = new AbortController()
    const connecting = connectLiveTransport({
      token: 'auth_tokens/test-ephemeral-token',
      model: 'test-live-model',
      direction: 'en-to-ur',
      signal: abortController.signal,
      events: {
        onAudio: vi.fn(),
        onTranscript: vi.fn(),
        onInterimTranscript: vi.fn(),
        onInterrupted: vi.fn(),
        onTurnComplete: vi.fn(),
        onClosed: vi.fn(),
        onError: vi.fn(),
      },
    })

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1)
    })
    expect(globalThis.WebSocket).toBe(FakeWebSocket)

    abortController.abort()

    await expect(connecting).rejects.toMatchObject({
      code: 'live-connection-failed',
    })
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalledOnce()

    // If the SDK still resolves after its raw socket was abandoned, the
    // transport closes the late Session rather than leaking it.
    resolveLateConnection({ close: closeLateSession })
    await vi.waitFor(() => {
      expect(closeLateSession).toHaveBeenCalledOnce()
    })
  })

  it('does not ask the SDK to connect when already cancelled', async () => {
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      connectLiveTransport({
        token: 'auth_tokens/test-ephemeral-token',
        model: 'test-live-model',
        direction: 'ur-to-en',
        signal: abortController.signal,
        events: {
          onAudio: vi.fn(),
          onTranscript: vi.fn(),
          onInterimTranscript: vi.fn(),
          onInterrupted: vi.fn(),
          onTurnComplete: vi.fn(),
          onClosed: vi.fn(),
          onError: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({ code: 'live-connection-failed' })

    expect(sdk.connect).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
