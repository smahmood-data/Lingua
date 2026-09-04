import { useMemo, useState } from 'react'
import type { SavedSession } from '../lib/sessionHistory'
import { formatTranscript, downloadText } from '../lib/sessionHistory'
import './HistoryPanel.css'

export function HistoryPanel({ sessions, onClose, onSelect, onDelete, onClear }: { sessions: SavedSession[]; onClose: () => void; onSelect: (session: SavedSession) => void; onDelete: (session: SavedSession) => void; onClear: () => void }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => session.turns.some((turn) => `${turn.sourceText} ${turn.translatedText}`.toLowerCase().includes(needle)))
  }, [query, sessions])

  return <aside className="history-panel" aria-label="Session history">
    <div className="panel-heading"><div><p className="eyebrow">Archive</p><h2>Session history</h2></div><button className="panel-close" onClick={onClose} aria-label="Close session history">×</button></div>
    <label className="history-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transcripts" aria-label="Search transcripts" /></label>
    {sessions.length ? <button type="button" className="clear-history" onClick={onClear}>Clear history</button> : null}
    <div className="history-list">
      {filtered.length === 0 ? <p className="history-empty">{sessions.length ? 'No sessions match that search.' : 'Completed conversations will appear here.'}</p> : filtered.map((session) => {
        const preview = session.turns.find((turn) => turn.sourceText)?.sourceText || 'Untitled conversation'
        return <div className="history-item" key={session.id}>
          <span className="history-date">{new Date(session.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button className="history-item-open" onClick={() => onSelect(session)}><strong>{preview.slice(0, 72)}{preview.length > 72 ? '…' : ''}</strong></button>
          <span>{session.turns.length} {session.turns.length === 1 ? 'turn' : 'turns'} · <span onClick={() => downloadText(`lingua-${session.id}.md`, formatTranscript(session))}>Export</span> · <button type="button" className="history-delete" onClick={() => onDelete(session)}>Delete</button></span>
        </div>
      })}
    </div>
  </aside>
}
