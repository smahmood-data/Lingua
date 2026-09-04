import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSavedSessions,
  createSessionId,
  deleteSavedSession,
  formatTranscript,
  loadSavedSessions,
  saveSession,
  saveSummary,
  speakerLabel,
} from './sessionHistory'
import type { ConversationTurn } from './translation'
import type { SavedSession } from './sessionHistory'

function ensureLocalStorage() {
  if (typeof (globalThis as unknown as { localStorage?: Storage }).localStorage !== 'undefined') return
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true, configurable: true })
}

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id: 'turn-1',
    sourceLanguage: 'en',
    sourceText: 'Hello',
    targetLanguage: 'es',
    translatedText: 'Hola',
    status: 'complete',
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeSession(overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    id: createSessionId(),
    createdAt: Date.now() - 1000,
    endedAt: Date.now(),
    sourceLanguage: 'auto',
    targetLanguage: 'es',
    counterpartLanguage: 'en',
    turns: [makeTurn()],
    ...overrides,
  }
}

describe('sessionHistory', () => {
  beforeAll(() => {
    ensureLocalStorage()
  })

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('creates unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createSessionId()))
    expect(ids.size).toBe(20)
  })

  it('saves and loads sessions', () => {
    const session = makeSession()
    saveSession(session)
    expect(loadSavedSessions()).toHaveLength(1)
    expect(loadSavedSessions()[0]?.id).toBe(session.id)
  })

  it('prevents duplicate ids by replacing', () => {
    const session = makeSession({ id: 'same-id' })
    saveSession(session)
    saveSession({ ...session, turns: [makeTurn({ id: 'turn-2', sourceText: 'Hi again' })] })
    const loaded = loadSavedSessions()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.turns[0]?.id).toBe('turn-2')
  })

  it('caps at 50 sessions', () => {
    for (let i = 0; i < 55; i++) {
      saveSession(makeSession({ id: `id-${i}` }))
    }
    expect(loadSavedSessions()).toHaveLength(50)
    // Most recent first
    expect(loadSavedSessions()[0]?.id).toBe('id-54')
  })

  it('returns empty for malformed stored data and repairs it', () => {
    localStorage.setItem('lingua-session-history-v1', 'not-json')
    expect(loadSavedSessions()).toEqual([])
    localStorage.setItem('lingua-session-history-v1', JSON.stringify({ not: 'array' }))
    expect(loadSavedSessions()).toEqual([])
    // Array with mixed valid and invalid entries
    const valid = makeSession({ id: 'valid-1' })
    localStorage.setItem('lingua-session-history-v1', JSON.stringify([valid, { id: '' }, null, 42, { id: 'bad', turns: [] }]))
    const loaded = loadSavedSessions()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id).toBe('valid-1')
    // Corrupt entry should have been repaired on load
    expect(JSON.parse(localStorage.getItem('lingua-session-history-v1')!).length).toBe(1)
  })

  it('handles unavailable localStorage gracefully', () => {
    const session = makeSession()
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    expect(loadSavedSessions()).toEqual([])
    vi.restoreAllMocks()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    // Must not throw
    expect(() => saveSession(session)).not.toThrow()
    expect(() => saveSummary(session.id, 'es', { summary: 'x', appointments: [], deadlines: [], instructions: [], locations: [], documents: [], decisions: [], clarifications: [], nextSteps: [] })).not.toThrow()
  })

  it('deletes and clears', () => {
    const a = makeSession({ id: 'a' })
    const b = makeSession({ id: 'b' })
    saveSession(a)
    saveSession(b)
    deleteSavedSession('a')
    expect(loadSavedSessions().map((s) => s.id)).toEqual(['b'])
    clearSavedSessions()
    expect(loadSavedSessions()).toEqual([])
  })

  it('saves summaries per language without clobbering', () => {
    const session = makeSession({ id: 'sum-1' })
    saveSession(session)
    const summaryEn = { summary: 'en summary', appointments: [], deadlines: [], instructions: [], locations: [], documents: [], decisions: [], clarifications: [], nextSteps: [] }
    const summaryEs = { summary: 'es summary', appointments: [], deadlines: [], instructions: [], locations: [], documents: [], decisions: [], clarifications: [], nextSteps: [] }
    saveSummary('sum-1', 'en', summaryEn)
    saveSummary('sum-1', 'es', summaryEs)
    const loaded = loadSavedSessions()[0]
    expect(loaded?.summaries?.en?.summary).toBe('en summary')
    expect(loaded?.summaries?.es?.summary).toBe('es summary')
  })

  it('formats transcript with language-based speaker labels, not index', () => {
    const session = makeSession({
      targetLanguage: 'es',
      turns: [
        makeTurn({ id: 't1', sourceLanguage: 'en', sourceText: 'Hello', translatedText: 'Hola' }),
        makeTurn({ id: 't2', sourceLanguage: 'en', sourceText: 'How are you?', translatedText: '¿Cómo estás?' }),
        makeTurn({ id: 't3', sourceLanguage: 'es', sourceText: 'Bien', translatedText: 'Good' }),
      ],
    })
    const md = formatTranscript(session)
    // Two English turns must have same label, not alternating A/B
    const englishLabels = (md.match(/Selected-language speaker/g) || []).length
    const detectedLabels = (md.match(/Detected-language speaker/g) || []).length
    // target es, so en is detected counterpart
    expect(detectedLabels).toBe(2)
    expect(englishLabels).toBe(1)
    expect(md).toContain('Hello')
    expect(md).toContain('Bien')
  })

  it('speakerLabel uses detected language, not position', () => {
    expect(speakerLabel({ sourceLanguage: 'en' }, 'es')).toBe('Detected-language speaker')
    expect(speakerLabel({ sourceLanguage: 'es' }, 'es')).toBe('Selected-language speaker')
    expect(speakerLabel({ sourceLanguage: null }, 'es')).toBe('Speaker unknown')
    // Same language repeated should not alternate
    expect(speakerLabel({ sourceLanguage: 'ur' }, 'en')).toBe('Detected-language speaker')
    expect(speakerLabel({ sourceLanguage: 'ur' }, 'en')).toBe('Detected-language speaker')
  })

  it('exports text and markdown variants', () => {
    const session = makeSession({ turns: [makeTurn({ sourceText: 'Hello', translatedText: '' })] })
    const text = formatTranscript(session, 'text')
    const md = formatTranscript(session, 'markdown')
    expect(text.startsWith('Lingua transcript')).toBe(true)
    expect(md.startsWith('# Lingua Transcript')).toBe(true)
  })

  it('rejects invalid sessions on save', () => {
    const invalid = { id: '', createdAt: NaN, endedAt: Date.now(), sourceLanguage: 'auto', targetLanguage: 'es', counterpartLanguage: null, turns: [] } as unknown as SavedSession
    saveSession(invalid)
    expect(loadSavedSessions()).toEqual([])
  })
})
