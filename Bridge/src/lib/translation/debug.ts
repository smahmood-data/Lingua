/**
 * Opt-in trace of what the live pipeline actually did.
 *
 * Off unless it is asked for, because everything interesting here happens in a
 * real browser with a real microphone in a real room, and none of that can be
 * reproduced from a test. Enable it with `?debugLive=1` (or
 * `localStorage.linguaDebugLive = '1'`), have the conversation, then read
 * `window.__linguaTrace` — or copy it with `copy(window.__linguaTrace)`.
 *
 * It records event names, route ids, turn ids and state transitions. It never
 * records tokens, audio, or anything from the server beyond the length of a
 * transcript, so a trace can be pasted into an issue safely.
 */

const RING_SIZE = 2000

export interface TraceEntry {
  /** Milliseconds since the trace was enabled. */
  t: number
  event: string
  detail?: Record<string, unknown>
}

interface TraceGlobal {
  __linguaTrace?: TraceEntry[]
  localStorage?: Storage
  location?: { search?: string }
}

let enabled: boolean | null = null
let started = 0
let ring: TraceEntry[] = []

function detect(): boolean {
  const scope = globalThis as unknown as TraceGlobal
  try {
    const search = scope.location?.search ?? ''
    if (/[?&]debugLive=1\b/.test(search)) return true
    return scope.localStorage?.getItem('linguaDebugLive') === '1'
  } catch {
    // Storage access throws in some privacy modes. Not being able to ask is
    // the same as not having been asked.
    return false
  }
}

/** Whether tracing is on. Resolved once, on first use. */
export function liveTraceEnabled(): boolean {
  if (enabled === null) {
    enabled = detect()
    if (enabled) {
      started = Date.now()
      ring = []
      ;(globalThis as unknown as TraceGlobal).__linguaTrace = ring
    }
  }
  return enabled
}

/** Record one event. Costs a function call and a boolean when disabled. */
export function liveTrace(event: string, detail?: Record<string, unknown>): void {
  if (!liveTraceEnabled()) return
  ring.push({ t: Date.now() - started, event, detail })
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
}

/** Forget everything recorded. Used by tests. */
export function resetLiveTrace(): void {
  enabled = null
  ring = []
}
