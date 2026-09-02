import { useState } from 'react'
import type { SavedSession } from '../lib/sessionHistory'
import { downloadText, formatTranscript } from '../lib/sessionHistory'
import { languageMetaFromCode } from '../types'
import { SummaryPanel } from './SummaryPanel'
import './TranscriptPanel.css'

export function TranscriptPanel({ session, onClose }: { session: SavedSession; onClose: () => void }) {
  const [summarizing, setSummarizing] = useState(false)
  const source = session.counterpartLanguage ? languageMetaFromCode(session.counterpartLanguage).label : 'Detected language'
  const target = languageMetaFromCode(session.targetLanguage).label

  if (summarizing) return <SummaryPanel session={session} onClose={() => setSummarizing(false)} />
  return <aside className="transcript-panel" aria-label="Saved transcript">
    <div className="panel-heading"><div><p className="eyebrow">Saved conversation</p><h2>Transcript</h2></div><button className="panel-close" onClick={onClose} aria-label="Close transcript">×</button></div>
    <p className="transcript-meta">{new Date(session.endedAt).toLocaleString()} · {source} ↔ {target}</p>
    <div className="transcript-copy">
      {session.turns.map((turn, index) => <article key={turn.id} className="transcript-turn">
        <p className="transcript-speaker">Participant {index % 2 === 0 ? 'A' : 'B'}</p>
        {turn.sourceText ? <p>{turn.sourceText}</p> : null}
        {turn.translatedText ? <p className="transcript-translation">{turn.translatedText}</p> : null}
      </article>)}
    </div>
    <div className="transcript-actions">
      <button type="button" className="primary-panel-action" onClick={() => setSummarizing(true)}>Summarize conversation</button>
      <button type="button" className="secondary-panel-action" onClick={() => downloadText(`lingua-${session.id}.md`, formatTranscript(session))}>Export transcript</button>
    </div>
  </aside>
}
