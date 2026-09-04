import type { ConversationTurn } from './translation'
import {
  isSourceLanguageCode,
  isSupportedLanguageCode,
  languageCodesMatch,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'

export interface ConversationSummary {
  summary: string
  appointments: Array<{ date: string | null; time: string | null; location: string | null; notes: string }>
  deadlines: string[]
  instructions: string[]
  locations: string[]
  documents: string[]
  decisions: string[]
  clarifications: string[]
  nextSteps: string[]
}

export interface SavedSession {
  id: string
  createdAt: number
  endedAt: number
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  counterpartLanguage: SupportedLanguageCode | null
  turns: ConversationTurn[]
  summaries?: Partial<Record<SupportedLanguageCode, ConversationSummary>>
}

const STORAGE_KEY = 'lingua-session-history-v1'
const MAX_SESSIONS = 50

function generateSessionId(): string {
  try {
    const candidate = (globalThis.crypto as Crypto | undefined)?.randomUUID?.()
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  } catch {
    // Fallback below when crypto is unavailable (e.g. insecure context tests).
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createSessionId(): string {
  return generateSessionId()
}

function isValidTurn(value: unknown): value is ConversationTurn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    (typeof candidate.sourceLanguage === 'string' || candidate.sourceLanguage === null) &&
    typeof candidate.sourceText === 'string' &&
    (typeof candidate.targetLanguage === 'string' || candidate.targetLanguage === null) &&
    typeof candidate.translatedText === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  )
}

function isValidSavedSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt)) return false
  if (typeof candidate.endedAt !== 'number' || !Number.isFinite(candidate.endedAt)) return false
  if (typeof candidate.sourceLanguage !== 'string' || !isSourceLanguageCode(candidate.sourceLanguage)) return false
  if (typeof candidate.targetLanguage !== 'string' || !isSupportedLanguageCode(candidate.targetLanguage)) return false
  if (
    candidate.counterpartLanguage !== null &&
    (typeof candidate.counterpartLanguage !== 'string' ||
      !isSupportedLanguageCode(candidate.counterpartLanguage))
  ) {
    return false
  }
  if (!Array.isArray(candidate.turns) || candidate.turns.length === 0) return false
  if (!candidate.turns.every(isValidTurn)) return false
  if (candidate.summaries !== undefined) {
    if (!candidate.summaries || typeof candidate.summaries !== 'object' || Array.isArray(candidate.summaries)) {
      return false
    }
  }
  return true
}

export function loadSavedSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = parsed.filter(isValidSavedSession)
    // If some entries were corrupt, rewrite the store to the valid subset so the
    // same corruption is not re-parsed on the next load. A quota failure here is
    // intentionally swallowed — history must never block live translation.
    if (valid.length !== parsed.length) {
      try {
        if (valid.length === 0) localStorage.removeItem(STORAGE_KEY)
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(valid))
      } catch {
        // Ignore storage write failure during migration.
      }
    }
    return valid
  } catch {
    return []
  }
}

export function saveSession(session: SavedSession): SavedSession[] {
  if (!isValidSavedSession(session)) return loadSavedSessions()
  const sessions = [session, ...loadSavedSessions().filter((item) => item.id !== session.id)].slice(0, MAX_SESSIONS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // History is a convenience; a full or unavailable storage must not affect live translation.
  }
  return sessions
}

export function clearSavedSessions(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be unavailable. */ }
}

export function deleteSavedSession(id: string): SavedSession[] {
  const sessions = loadSavedSessions().filter((session) => session.id !== id)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)) } catch { /* Storage may be unavailable. */ }
  return sessions
}

export function saveSummary(
  sessionId: string,
  language: SupportedLanguageCode,
  summary: ConversationSummary,
): SavedSession[] {
  if (!isSupportedLanguageCode(language)) return loadSavedSessions()
  const sessions = loadSavedSessions().map((session) =>
    session.id === sessionId
      ? { ...session, summaries: { ...session.summaries, [language]: summary } }
      : session,
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // A summary cache is a convenience; storage failures must not block review.
  }
  return sessions
}

export function speakerLabel(
  turn: Pick<ConversationTurn, 'sourceLanguage'>,
  selectedLanguage: SupportedLanguageCode,
): string {
  if (!turn.sourceLanguage) return 'Speaker unknown'
  return languageCodesMatch(turn.sourceLanguage, selectedLanguage)
    ? 'Selected-language speaker'
    : 'Detected-language speaker'
}

export function formatTranscript(session: SavedSession, format: 'markdown' | 'text' = 'markdown'): string {
  const date = new Date(session.endedAt).toLocaleString()
  const lines = session.turns.flatMap((turn) => {
    const speaker = speakerLabel(turn, session.targetLanguage)
    const result = [`${speaker}: ${turn.sourceText || '[No original transcript]'}`]
    if (turn.translatedText) result.push(`Translation: ${turn.translatedText}`)
    return result
  })
  if (format === 'text') return [`Lingua transcript`, `Date: ${date}`, '', ...lines].join('\n')
  return [`# Lingua Transcript`, '', `**Date:** ${date}`, '', ...lines.map((line) => `- ${line}`)].join('\n')
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
