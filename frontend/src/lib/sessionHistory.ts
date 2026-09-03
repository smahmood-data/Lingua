import type { ConversationTurn } from './translation'
import { languageCodesMatch, type SourceLanguageCode, type SupportedLanguageCode } from '../types'

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

export function loadSavedSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSession(session: SavedSession): SavedSession[] {
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
