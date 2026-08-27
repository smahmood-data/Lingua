import { statusMeta } from '../data/mockTranscripts'
import type { AppStatus } from '../types'
import './StatusNotice.css'

// Problem states get one clear inline notice with a next step.
// Loading is handled by the transcript's connecting state instead.
export function StatusNotice({ status }: { status: AppStatus }) {
  const meta = statusMeta[status]
  if (!meta.noticeTitle) return null

  return (
    <div
      className={`status-notice notice-${meta.tone}`}
      role={status === 'error' || status === 'denied' ? 'alert' : 'status'}
    >
      <div className="notice-text">
        <p className="notice-title">{meta.noticeTitle}</p>
        <p className="notice-detail">{meta.noticeDetail}</p>
      </div>
    </div>
  )
}
