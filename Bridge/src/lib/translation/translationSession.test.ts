import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveTransport, LiveTransportOptions } from './liveTransport'
import type { MicrophoneCapture } from './audio/microphoneCapture'
import type { PlaybackScheduler } from './audio/playbackScheduler'

const dependencies = vi.hoisted(() => ({
  createPlaybackScheduler: vi.fn(),
  startMicrophoneCapture: vi.fn(),
  connectLiveTransport: vi.fn(),
}))

vi.mock('./audio/playbackScheduler', () => ({
  createPlaybackScheduler: dependencies.createPlaybackScheduler,
}))
vi.mock('./audio/microphoneCapture', () => ({
  startMicrophoneCapture: dependencies.startMicrophoneCapture,
}))
vi.mock('./liveTransport', () => ({
  connectLiveTransport: dependencies.connectLiveTransport,
}))

import { TranslationSession } from './translationSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function playback(): PlaybackScheduler {
  return {
    enqueue: vi.fn(),
    flush: vi.fn(),
    dispose: vi.fn(async () => undefined),
  }
}

function capture(onStop: () => void = () => undefined): MicrophoneCapture {
  let stopped = false
  return {
    sampleRate: 16_000,
    stop: vi.fn(async () => {
      if (!stopped) {
        stopped = true
        onStop()
      }
    }),
  }
}

function transport(onClose: () => void = () => undefined): LiveTransport {
  let closed = false
  return {
    sendAudioChunk: vi.fn(),
    close: vi.fn(() => {
      if (!closed) {
        closed = true
        onClose()
      }
    }),
  }
}

function session(): TranslationSession {
  return new TranslationSession({
    tokenProvider: vi.fn(async () => ({
      token: 'auth_tokens/test-ephemeral-token',
      model: 'test-live-model',
    })),
  })
}

describe('TranslationSession startup ownership', () => {
  beforeEach(() => {
    dependencies.createPlaybackScheduler.mockReset()
    dependencies.startMicrophoneCapture.mockReset()
    dependencies.connectLiveTransport.mockReset()
    dependencies.createPlaybackScheduler.mockImplementation(async () => playback())
  })

  it('waits for a pending microphone factory to clean up before restarting', async () => {
    const firstCapture = deferred<MicrophoneCapture>()
    let activeCaptures = 0
    let maximumCaptures = 0
    const beginCapture = () => {
      activeCaptures += 1
      maximumCaptures = Math.max(maximumCaptures, activeCaptures)
      return capture(() => {
        activeCaptures -= 1
      })
    }

    dependencies.startMicrophoneCapture
      .mockImplementationOnce(() => firstCapture.promise)
      .mockImplementationOnce(async () => beginCapture())
    dependencies.connectLiveTransport.mockImplementation(async () => transport())

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.startMicrophoneCapture).toHaveBeenCalledTimes(1)
    })

    const stopping = controller.stop()
    const restarting = controller.start('en-to-ur')
    await Promise.resolve()
    expect(dependencies.startMicrophoneCapture).toHaveBeenCalledTimes(1)

    const lateCapture = beginCapture()
    firstCapture.resolve(lateCapture)
    await Promise.all([firstStart, stopping, restarting])

    expect(lateCapture.stop).toHaveBeenCalledOnce()
    expect(dependencies.startMicrophoneCapture).toHaveBeenCalledTimes(2)
    expect(maximumCaptures).toBe(1)
    expect(controller.getSnapshot()).toMatchObject({
      state: 'listening',
      direction: 'en-to-ur',
    })

    await controller.stop()
    expect(activeCaptures).toBe(0)
  })

  it('waits for a pending playback factory to clean up before restarting', async () => {
    const firstPlayback = deferred<PlaybackScheduler>()
    const latePlayback = playback()
    dependencies.createPlaybackScheduler
      .mockImplementationOnce(() => firstPlayback.promise)
      .mockImplementationOnce(async () => playback())
    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(async () => transport())

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()
    })

    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.resolve()
    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()

    firstPlayback.resolve(latePlayback)
    await Promise.all([firstStart, stopping, restarting])

    expect(latePlayback.dispose).toHaveBeenCalledOnce()
    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().state).toBe('listening')
    await controller.stop()
  })

  it('does not connect a superseded token request or overlap its restart', async () => {
    const firstToken = deferred<{
      token: string
      model: string
    }>()
    const tokenProvider = vi
      .fn()
      .mockImplementationOnce(() => firstToken.promise)
      .mockImplementationOnce(async () => ({
        token: 'auth_tokens/replacement-token',
        model: 'test-live-model',
      }))
    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(async () => transport())

    const controller = new TranslationSession({ tokenProvider })
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(tokenProvider).toHaveBeenCalledOnce()
    })

    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.resolve()
    expect(tokenProvider).toHaveBeenCalledOnce()
    expect(dependencies.connectLiveTransport).not.toHaveBeenCalled()

    firstToken.resolve({
      token: 'auth_tokens/superseded-token',
      model: 'test-live-model',
    })
    await Promise.all([firstStart, stopping, restarting])

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(dependencies.connectLiveTransport).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().state).toBe('listening')
    await controller.stop()
  })

  it('aborts a pending Live handshake before opening the replacement', async () => {
    let activeConnections = 0
    let maximumConnections = 0
    let firstSignal: AbortSignal | undefined

    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport
      .mockImplementationOnce((options: LiveTransportOptions) => {
        firstSignal = options.signal
        activeConnections += 1
        maximumConnections = Math.max(maximumConnections, activeConnections)
        return new Promise<LiveTransport>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              activeConnections -= 1
              reject(new Error('cancelled'))
            },
            { once: true },
          )
        })
      })
      .mockImplementationOnce(async () => {
        activeConnections += 1
        maximumConnections = Math.max(maximumConnections, activeConnections)
        return transport(() => {
          activeConnections -= 1
        })
      })

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.connectLiveTransport).toHaveBeenCalledTimes(1)
    })

    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.all([firstStart, stopping, restarting])

    expect(firstSignal?.aborted).toBe(true)
    expect(dependencies.connectLiveTransport).toHaveBeenCalledTimes(2)
    expect(maximumConnections).toBe(1)
    expect(activeConnections).toBe(1)

    await controller.stop()
    expect(activeConnections).toBe(0)
  })

  it('invalidates a queued restart when a later stop represents unmount', async () => {
    const captureStop = deferred<void>()
    const slowCapture: MicrophoneCapture = {
      sampleRate: 16_000,
      stop: vi.fn(() => captureStop.promise),
    }
    dependencies.startMicrophoneCapture.mockResolvedValue(slowCapture)
    dependencies.connectLiveTransport.mockResolvedValue(transport())

    const controller = session()
    await controller.start()

    const firstStop = controller.stop()
    await vi.waitFor(() => {
      expect(slowCapture.stop).toHaveBeenCalledOnce()
    })
    const queuedRestart = controller.start()
    const unmountStop = controller.stop()

    captureStop.resolve()
    await Promise.all([firstStop, queuedRestart, unmountStop])

    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()
    expect(dependencies.startMicrophoneCapture).toHaveBeenCalledOnce()
    expect(dependencies.connectLiveTransport).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().state).toBe('stopped')
  })

  it('makes concurrent dispose calls wait for the same shutdown', async () => {
    const captureStop = deferred<void>()
    const slowCapture: MicrophoneCapture = {
      sampleRate: 16_000,
      stop: vi.fn(() => captureStop.promise),
    }
    dependencies.startMicrophoneCapture.mockResolvedValue(slowCapture)
    dependencies.connectLiveTransport.mockResolvedValue(transport())

    const controller = session()
    await controller.start()

    const firstDispose = controller.dispose()
    await vi.waitFor(() => {
      expect(slowCapture.stop).toHaveBeenCalledOnce()
    })
    let secondSettled = false
    const secondDispose = controller.dispose().then(() => {
      secondSettled = true
    })
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    captureStop.resolve()
    await Promise.all([firstDispose, secondDispose])
    expect(secondSettled).toBe(true)

    await controller.start()
    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()
  })

  it('finishes a direction switch before the new direction can connect', async () => {
    let activeConnections = 0
    let maximumConnections = 0
    const connectedDirections: string[] = []

    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(
      (options: LiveTransportOptions) => {
        connectedDirections.push(options.direction)
        activeConnections += 1
        maximumConnections = Math.max(maximumConnections, activeConnections)

        if (connectedDirections.length === 1) {
          return new Promise<LiveTransport>((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                activeConnections -= 1
                reject(new Error('cancelled'))
              },
              { once: true },
            )
          })
        }

        return Promise.resolve(
          transport(() => {
            activeConnections -= 1
          }),
        )
      },
    )

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.connectLiveTransport).toHaveBeenCalledOnce()
    })

    await controller.setDirection('en-to-ur')
    await firstStart
    expect(controller.getSnapshot()).toMatchObject({
      state: 'stopped',
      direction: 'en-to-ur',
    })
    expect(activeConnections).toBe(0)

    await controller.start()
    expect(connectedDirections).toEqual(['ur-to-en', 'en-to-ur'])
    expect(maximumConnections).toBe(1)

    await controller.stop()
    expect(activeConnections).toBe(0)
  })

  it('opens both live directions for a two-way conversation', async () => {
    const connectedDirections: string[] = []
    const tokenDirections: string[] = []
    const tokenProvider = vi.fn(async ({ direction }: { direction: string }) => {
      tokenDirections.push(direction)
      return {
        token: 'auth_tokens/test-ephemeral-token',
        model: 'test-live-model',
      }
    })

    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(
      (options: LiveTransportOptions) => {
        connectedDirections.push(options.direction)
        return Promise.resolve(transport())
      },
    )

    const controller = new TranslationSession({ tokenProvider })
    await controller.startConversation('es')

    expect(tokenDirections.sort()).toEqual(['en-to-es', 'es-to-en'])
    expect(connectedDirections.sort()).toEqual(['en-to-es', 'es-to-en'])
    expect(controller.getSnapshot().state).toBe('listening')

    await controller.stop()
  })
})
