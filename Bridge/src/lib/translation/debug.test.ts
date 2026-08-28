import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { liveTrace, liveTraceEnabled, resetLiveTrace } from './debug'

interface TraceScope {
  __linguaTrace?: unknown
  location?: { search?: string }
  localStorage?: Pick<Storage, 'getItem'>
}

const scope = globalThis as unknown as TraceScope

describe('live trace', () => {
  beforeEach(() => {
    resetLiveTrace()
    delete scope.__linguaTrace
    delete scope.location
    delete scope.localStorage
  })
  afterEach(() => {
    resetLiveTrace()
    delete scope.__linguaTrace
    delete scope.location
    delete scope.localStorage
  })

  it('is off, and silent, unless it has been asked for', () => {
    expect(liveTraceEnabled()).toBe(false)
    liveTrace('speech-start', { route: 1 })
    expect(scope.__linguaTrace).toBeUndefined()
  })

  it('records to the page when the query parameter is present', () => {
    scope.location = { search: '?debugLive=1' }
    liveTrace('speech-start', { route: 1 })
    liveTrace('turn-open', { turn: 'turn-1' })

    const entries = scope.__linguaTrace as { event: string; t: number }[]
    expect(entries.map((entry) => entry.event)).toEqual([
      'speech-start',
      'turn-open',
    ])
    expect(entries[0].t).toBeGreaterThanOrEqual(0)
  })

  it('can be turned on for a browser that is already open', () => {
    scope.localStorage = { getItem: (key) => (key === 'linguaDebugLive' ? '1' : null) }
    liveTrace('playback-start')
    expect((scope.__linguaTrace as unknown[]).length).toBe(1)
  })

  it('survives storage that refuses to be read', () => {
    scope.localStorage = {
      getItem: () => {
        throw new Error('blocked in this privacy mode')
      },
    }
    expect(() => liveTrace('playback-start')).not.toThrow()
    expect(liveTraceEnabled()).toBe(false)
  })
})
