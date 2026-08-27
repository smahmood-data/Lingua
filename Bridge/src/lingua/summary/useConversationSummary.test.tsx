// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConversationSummary } from './useConversationSummary.ts'
import { emptySummary, type ConversationSummary } from './types.ts'

const FOUND: ConversationSummary = {
  ...emptySummary(),
  summary: 'Appointment confirmed.',
  appointments: ['September 12 at 3:30 PM'],
}

const respond = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

function mockFetch(impl: () => Promise<Response> | Response) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => impl())
  vi.stubGlobal('fetch', spy)
  return spy
}

/** The transcript the server was actually asked to summarise. */
const sentTurns = (spy: ReturnType<typeof mockFetch>): string[] =>
  JSON.parse(String(spy.mock.calls[0]![1]!.body)).turns.map(
    (turn: { original: string }) => turn.original,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('recording turns', () => {
  it('ignores a turn with no speech and keeps the button disabled', () => {
    mockFetch(() => respond(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: '   ' }))

    expect(result.current.turns).toHaveLength(0)
    expect(result.current.canSummarize).toBe(false)
  })

  it('enables summarising once somebody speaks', () => {
    mockFetch(() => respond(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Hello' }))

    expect(result.current.canSummarize).toBe(true)
  })
})

describe('endConversation', () => {
  it('reports empty without calling the server when nobody spoke', () => {
    const fetchSpy = mockFetch(() => respond(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.endConversation())

    expect(result.current.state).toEqual({ status: 'empty' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('loads and then becomes ready', async () => {
    mockFetch(() => respond(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'other', original: 'Arrive at 3:15 PM.' }))
    act(() => result.current.endConversation())

    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', summary: FOUND }))
  })

  /**
   * The conversation UI finalises the last turn and ends the session from the
   * same click. Reading the transcript from React state instead of the ref
   * dropped that turn, and dropped a whole opening burst entirely.
   */
  it('sends a turn recorded in the same tick as the end of the conversation', async () => {
    const fetchSpy = mockFetch(() => respond(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'other', original: 'first' }))
    act(() => {
      result.current.recordTurn({ speaker: 'other', original: 'bring your insurance card' })
      result.current.endConversation()
    })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(sentTurns(fetchSpy)).toEqual(['first', 'bring your insurance card'])
  })

  it('summarises a burst of turns that ends in the same tick as the first turn', async () => {
    const fetchSpy = mockFetch(() => respond(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => {
      result.current.recordTurn({ speaker: 'other', original: 'A' })
      result.current.recordTurn({ speaker: 'user', original: 'B' })
      result.current.recordTurn({ speaker: 'other', original: 'C' })
      result.current.endConversation()
    })

    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce())
    expect(sentTurns(fetchSpy)).toEqual(['A', 'B', 'C'])
  })
})

describe('safe states', () => {
  it.each([
    ['a network failure', () => { throw new TypeError('Failed to fetch') }, 'network_error'],
    ['an unreachable Gemini', () => respond({ error: { code: 'upstream_unavailable' } }, 502), 'upstream_unavailable'],
    ['untrusted model output', () => respond({ error: { code: 'invalid_model_output' } }, 502), 'invalid_model_output'],
    ['an oversized transcript', () => respond({ error: { code: 'payload_too_large' } }, 413), 'payload_too_large'],
    ['an unexpected server failure', () => respond({ error: { code: 'internal_error' } }, 500), 'internal_error'],
    ['a response that is not the contract', () => respond({ summary: 'ok' }), 'malformed_response'],
    ['an HTML error page', () => ({ ok: false, status: 400, json: async () => { throw new SyntaxError('<') } }) as unknown as Response, 'malformed_response'],
  ])('turns %s into an error state', async (_label, impl, code) => {
    mockFetch(impl as () => Response)
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Hello' }))
    act(() => result.current.endConversation())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', code }))
  })

  it('treats a server-side empty transcript as empty, not as a failure', async () => {
    mockFetch(() => respond({ error: { code: 'empty_transcript' } }, 422))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Hello' }))
    act(() => result.current.endConversation())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }))
  })

  /** A real model writes prose even when it extracts nothing actionable. */
  it('reports nothing-found when every category is empty but prose came back', async () => {
    const chatter = { ...emptySummary(), summary: 'A brief exchange about the weather.' }
    mockFetch(() => respond(chatter))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Nice weather.' }))
    act(() => result.current.endConversation())

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'nothing-found', summary: chatter }),
    )
  })
})

describe('cancellation and cleanup', () => {
  const slow = (body: unknown) => async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
    return respond(body)
  }

  it('keeps only the last result when the control is pressed twice quickly', async () => {
    let call = 0
    const fetchSpy = mockFetch(async () => {
      const mine = ++call
      await new Promise((resolve) => setTimeout(resolve, mine === 1 ? 60 : 5))
      return respond({ ...FOUND, summary: `call-${mine}` })
    })
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Hello' }))
    act(() => {
      result.current.endConversation()
      result.current.endConversation()
    })

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result.current.state).toEqual({
      status: 'ready',
      summary: { ...FOUND, summary: 'call-2' },
    })
  })

  it('reset() clears the transcript and a late response cannot overwrite idle', async () => {
    mockFetch(slow(FOUND))
    const { result } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Hello' }))
    act(() => result.current.endConversation())
    act(() => result.current.reset())

    expect(result.current.state).toEqual({ status: 'idle' })
    expect(result.current.turns).toEqual([])
    expect(result.current.canSummarize).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('a summary still in flight at unmount never sets state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(slow(FOUND))
    const { result, unmount } = renderHook(() => useConversationSummary('ur'))

    act(() => result.current.recordTurn({ speaker: 'user', original: 'Hello' }))
    act(() => result.current.endConversation())
    unmount()

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('starts a fresh transcript after a remount, so a refresh keeps nothing', () => {
    mockFetch(() => respond(FOUND))
    const first = renderHook(() => useConversationSummary('ur'))
    act(() => first.result.current.recordTurn({ speaker: 'user', original: 'Hello' }))
    expect(first.result.current.turns).toHaveLength(1)
    first.unmount()

    const second = renderHook(() => useConversationSummary('ur'))
    expect(second.result.current.turns).toEqual([])
    expect(second.result.current.state).toEqual({ status: 'idle' })
  })
})
