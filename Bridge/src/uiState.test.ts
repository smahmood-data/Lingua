import { describe, expect, it } from 'vitest'
import type { SessionError, SessionErrorCode } from './lib/translation'
import {
  consoleCopy,
  deriveUiState,
  micActionLabel,
  micIsActive,
  micIsBusy,
  noticeCopy,
  statusChipLabel,
  type UiState,
} from './uiState'

function makeError(code: SessionErrorCode): SessionError {
  return { code, message: 'user-safe message', recoverable: true }
}

describe('deriveUiState', () => {
  it('maps the resting session to idle', () => {
    expect(deriveUiState('stopped', null, null)).toBe('idle')
  })

  it('maps each live session phase to itself', () => {
    expect(deriveUiState('connecting', null, null)).toBe('connecting')
    expect(deriveUiState('listening', null, null)).toBe('listening')
    expect(deriveUiState('translating', null, null)).toBe('translating')
    expect(deriveUiState('playing', null, null)).toBe('playing')
  })

  it('shows stopping only while the session has not settled yet', () => {
    expect(deriveUiState('playing', null, 'stop')).toBe('stopping')
    expect(deriveUiState('stopped', null, 'stop')).toBe('idle')
  })

  it('shows connecting for a start the session has not announced', () => {
    expect(deriveUiState('stopped', null, 'start')).toBe('connecting')
    expect(deriveUiState('listening', null, 'start')).toBe('listening')
  })

  it('groups microphone failures into the permission state', () => {
    expect(
      deriveUiState('error', makeError('microphone-permission-denied'), null),
    ).toBe('permission')
    expect(
      deriveUiState('error', makeError('microphone-unavailable'), null),
    ).toBe('permission')
    expect(
      deriveUiState('error', makeError('unsupported-browser'), null),
    ).toBe('permission')
  })

  it('keeps disconnection and other failures distinct', () => {
    expect(deriveUiState('error', makeError('live-disconnected'), null)).toBe(
      'disconnected',
    )
    expect(deriveUiState('error', makeError('token-request-failed'), null)).toBe(
      'error',
    )
    expect(deriveUiState('error', makeError('unknown'), null)).toBe('error')
  })

  it('lets a real error outrank a pending stop', () => {
    expect(deriveUiState('error', makeError('unknown'), 'stop')).toBe('error')
  })
})

describe('mic affordances', () => {
  it('is busy only through the transitional states', () => {
    expect(micIsBusy('connecting')).toBe(true)
    expect(micIsBusy('stopping')).toBe(true)
    expect(micIsBusy('listening')).toBe(false)
    expect(micIsBusy('idle')).toBe(false)
  })

  it('is active exactly while the session is live', () => {
    expect(micIsActive('listening')).toBe(true)
    expect(micIsActive('translating')).toBe(true)
    expect(micIsActive('playing')).toBe(true)
    expect(micIsActive('connecting')).toBe(false)
    expect(micIsActive('idle')).toBe(false)
  })
})

describe('copy', () => {
  const languages = {
    source: 'Bengali',
    target: 'English',
    detected: null,
    liveTarget: null,
  }

  it('has something to say in every state', () => {
    const states: UiState[] = [
      'idle',
      'permission',
      'connecting',
      'listening',
      'translating',
      'playing',
      'stopping',
      'disconnected',
      'error',
    ]
    for (const state of states) {
      expect(consoleCopy(state, languages).primary.length).toBeGreaterThan(0)
      expect(statusChipLabel(state).length).toBeGreaterThan(0)
      expect(micActionLabel(state).length).toBeGreaterThan(0)
    }
  })

  it('names the language being spoken while playing', () => {
    const copy = consoleCopy('playing', { ...languages, liveTarget: 'Bengali' })
    expect(copy.primary).toContain('Bengali')
  })

  it('never invites a retry the product cannot honor', () => {
    const unsupported = noticeCopy(makeError('unsupported-browser'))
    expect(unsupported.detail).not.toContain('tap the microphone')
  })

  it('has calm, specific copy for every error code', () => {
    const codes: SessionErrorCode[] = [
      'microphone-permission-denied',
      'microphone-unavailable',
      'unsupported-browser',
      'token-request-failed',
      'live-connection-failed',
      'live-disconnected',
      'unknown',
    ]
    for (const code of codes) {
      const copy = noticeCopy(makeError(code))
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.detail.length).toBeGreaterThan(0)
    }
  })
})
