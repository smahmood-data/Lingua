import type { SessionError } from '../lib/translation'
import { noticeCopy } from '../uiState'
import './StatusNotice.css'

// Problems get one calm inline strip: what happened, and the step that helps.
export function StatusNotice({ error }: { error: SessionError }) {
  const copy = noticeCopy(error)

  return (
    <div className={`status-notice notice-${copy.tone}`} role="alert">
      <span className="notice-marker" aria-hidden="true" />
      <div className="notice-text">
        <p className="notice-title">{copy.title}</p>
        <p className="notice-detail">{copy.detail}</p>
      </div>
    </div>
  )
}
