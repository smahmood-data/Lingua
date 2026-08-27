import type { SessionState } from './types'

/**
 * Session lifecycle transitions, kept pure so the controller cannot drift into
 * an impossible state and so the rules can be tested without audio hardware.
 */
export type SessionEvent =
  | 'START'
  | 'CONNECTED'
  | 'OUTPUT_START'
  | 'OUTPUT_END'
  | 'STOP'
  | 'FAIL'

export const INITIAL_SESSION_STATE: SessionState = 'stopped'

const TRANSITIONS: Record<SessionState, Partial<Record<SessionEvent, SessionState>>> = {
  stopped: {
    START: 'connecting',
    STOP: 'stopped',
  },
  connecting: {
    CONNECTED: 'listening',
    STOP: 'stopped',
    FAIL: 'error',
  },
  listening: {
    OUTPUT_START: 'translating',
    STOP: 'stopped',
    FAIL: 'error',
  },
  translating: {
    OUTPUT_END: 'listening',
    STOP: 'stopped',
    FAIL: 'error',
  },
  error: {
    START: 'connecting',
    STOP: 'stopped',
    FAIL: 'error',
  },
}

/**
 * Returns the next state, or `null` when the event does not apply. Callers treat
 * `null` as "ignore" rather than as an error: late events from a session that has
 * already been torn down are expected.
 */
export function nextSessionState(
  current: SessionState,
  event: SessionEvent,
): SessionState | null {
  return TRANSITIONS[current][event] ?? null
}

/** A session may only be started from a resting state. */
export function canStart(state: SessionState): boolean {
  return state === 'stopped' || state === 'error'
}

/** True while microphone and Live resources are expected to be held. */
export function isSessionActive(state: SessionState): boolean {
  return state === 'connecting' || state === 'listening' || state === 'translating'
}
