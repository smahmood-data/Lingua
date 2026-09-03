import { useEffect, useState } from 'react'
import type { ConversationSummary, SavedSession } from '../lib/sessionHistory'
import { speakerLabel } from '../lib/sessionHistory'
import { languageMetaFromCode, type SupportedLanguageCode } from '../types'
import { LanguageSelect } from './LanguageSelect'
import './SummaryPanel.css'

export function SummaryPanel({ session, onClose, onSaveSession }: { session: SavedSession; onClose: () => void; onSaveSession: (session: SavedSession) => void }) {
  const [language, setLanguage] = useState<SupportedLanguageCode>(session.targetLanguage)
  const [result, setResult] = useState<ConversationSummary | null>(session.summaries?.[session.targetLanguage] ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const cached = session.summaries?.[language]
    setResult(cached ?? null)
    setError(null)
    if (cached) return
    const controller = new AbortController()
    const transcript = session.turns.filter((turn) => turn.sourceText || turn.translatedText).map((turn) => ({ id: turn.id, speaker: speakerLabel(turn, session.targetLanguage), originalText: turn.sourceText, translatedText: turn.translatedText, timestamp: new Date(turn.createdAt).toISOString() }))
    fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, preferredLanguage: languageMetaFromCode(language).label }), signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Unable to generate summary.'); return body.summary as ConversationSummary })
      .then((summary) => { setResult(summary); onSaveSession({ ...session, summaries: { ...session.summaries, [language]: summary } }) })
      .catch((cause: Error) => { if (cause.name !== 'AbortError') setError(cause.message) })
    return () => controller.abort()
  }, [language, onSaveSession, session])

  const context = result?.summary || 'A two-person professional conversation was recorded.'
  const languageLabel = languageMetaFromCode(language).label
  return <aside className="summary-panel" aria-label="Conversation summary">
    <div className="panel-heading"><div><p className="eyebrow">Review</p><h2>Meeting summary</h2></div><button className="panel-close" onClick={onClose} aria-label="Close summary">×</button></div>
    <div className="summary-language"><label>Summary language<LanguageSelect label="Summary language" value={language} onChange={(code) => { if (code !== 'auto') setLanguage(code) }} /></label></div>
    {error ? <p className="summary-error">{error}</p> : !result ? <p className="summary-loading">Preparing a summary in {languageLabel}…</p> : <div className="summary-content">
      <h3>Two-Person Professional Meeting Summary</h3>
      <dl className="summary-meta"><div><dt>Context</dt><dd>{languageLabel} summary</dd></div><div><dt>Participants</dt><dd>Detected-language and selected-language speakers</dd></div><div><dt>Date</dt><dd>{new Date(session.endedAt).toLocaleDateString()}</dd></div></dl>
      <section><h4>1. Core Discussion &amp; Clinical/Business Context</h4><p>{context}</p></section>
      <SummaryList title="2. Decisions & Consensus" items={result.decisions} label="Decision" />
      <SummaryList title="3. Action Items & Accountability" items={result.nextSteps} label="Action" />
      <SummaryList title="4. Open Queries & Follow-ups" items={result.clarifications} label="Open item" />
      {result.appointments.length ? <SummaryList title="Appointments" items={result.appointments.map((appointment) => [appointment.date, appointment.time, appointment.location, appointment.notes].filter(Boolean).join(' · '))} label="Appointment" /> : null}
      <SummaryList title="Deadlines" items={result.deadlines} label="Deadline" />
      <SummaryList title="Instructions" items={result.instructions} label="Instruction" />
      <SummaryList title="Locations" items={result.locations} label="Location" />
      <SummaryList title="Documents" items={result.documents} label="Document" />
    </div>}
  </aside>
}

function SummaryList({ title, items, label }: { title: string; items: string[]; label: string }) {
  return <section><h4>{title}</h4>{items.length ? <ul>{items.map((item) => <li key={item}><strong>{label}:</strong> {item}</li>)}</ul> : <p className="muted">No relevant data identified.</p>}</section>
}
