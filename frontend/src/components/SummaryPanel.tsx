import { useEffect, useState } from 'react'
import type { SavedSession } from '../lib/sessionHistory'
import { languageMetaFromCode } from '../types'
import './SummaryPanel.css'

type Summary = { summary: string; decisions: string[]; nextSteps: string[]; clarifications: string[]; deadlines: string[]; instructions: string[]; locations: string[]; documents: string[] }

export function SummaryPanel({ session, onClose }: { session: SavedSession; onClose: () => void }) {
  const [result, setResult] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const transcript = session.turns.filter((turn) => turn.sourceText || turn.translatedText).map((turn, index) => ({ id: turn.id, speaker: index % 2 === 0 ? 'Participant A' : 'Participant B', originalText: turn.sourceText, translatedText: turn.translatedText, timestamp: new Date(turn.createdAt).toISOString() }))
    fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, preferredLanguage: 'English' }) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Unable to generate summary.'); return body.summary as Summary })
      .then(setResult).catch((cause: Error) => setError(cause.message))
  }, [session])

  const context = result?.summary || 'A two-person professional conversation was recorded.'
  const language = languageMetaFromCode(session.targetLanguage).label
  return <aside className="summary-panel" aria-label="Conversation summary">
    <div className="panel-heading"><div><p className="eyebrow">Review</p><h2>Meeting summary</h2></div><button className="panel-close" onClick={onClose} aria-label="Close summary">×</button></div>
    {error ? <p className="summary-error">{error}</p> : !result ? <p className="summary-loading">Preparing a structured summary…</p> : <div className="summary-content">
      <h3>Two-Person Professional Meeting Summary</h3>
      <dl className="summary-meta"><div><dt>Context</dt><dd>{language} conversation</dd></div><div><dt>Participants</dt><dd>Participant A &amp; Participant B</dd></div><div><dt>Date</dt><dd>{new Date(session.endedAt).toLocaleDateString()}</dd></div></dl>
      <section><h4>1. Core Discussion &amp; Clinical/Business Context</h4><p>{context}</p></section>
      <SummaryList title="2. Decisions & Consensus" items={result.decisions} label="Decision" />
      <section><h4>3. Action Items &amp; Accountability</h4>{result.nextSteps.length ? <table className="action-table"><thead><tr><th>Action / Deliverable</th><th>Owner</th><th>Deadline</th></tr></thead><tbody>{result.nextSteps.map((item, index) => <tr key={item}><td>{item}</td><td>Participant {index % 2 === 0 ? 'A' : 'B'}</td><td>Immediate</td></tr>)}</tbody></table> : <p className="muted">No action items identified.</p>}</section>
      <SummaryList title="4. Open Queries & Follow-ups" items={result.clarifications} label="Open item" />
      {(result.deadlines.length || result.instructions.length || result.locations.length || result.documents.length) ? <section><h4>Additional details</h4><ul>{[...result.deadlines, ...result.instructions, ...result.locations, ...result.documents].map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    </div>}
  </aside>
}

function SummaryList({ title, items, label }: { title: string; items: string[]; label: string }) {
  return <section><h4>{title}</h4>{items.length ? <ul>{items.map((item) => <li key={item}><strong>{label}:</strong> {item}</li>)}</ul> : <p className="muted">No relevant data identified.</p>}</section>
}
