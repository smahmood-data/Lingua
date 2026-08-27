import { statusMeta } from '../data/mockTranscripts'
import type { AppStatus } from '../types'
import './TopBar.css'

function SwapGlyph() {
  return (
    <svg
      className="pair-swap"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 3.5h8m0 0-2.25-2.25M12.5 3.5 10.25 5.75M11.5 12.5h-8m0 0 2.25 2.25M3.5 12.5l2.25-2.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatusIndicator({ status }: { status: AppStatus }) {
  const meta = statusMeta[status]

  return (
    <div
      className={`status-indicator status-${meta.tone}`}
      aria-live="polite"
      aria-label={`Status: ${meta.label}`}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{meta.label}</span>
    </div>
  )
}

export function TopBar({ status }: { status: AppStatus }) {
  return (
    <header className="topbar">
      <div className="brand">
        {/* lām — the "L" of Lingua — anchors the wordmark */}
        <span className="brand-mark" aria-hidden="true" lang="ar">
          ل
        </span>
        <h1 className="brand-name">Lingua</h1>
      </div>

      <p className="language-pair" aria-label="Translating between English and Urdu">
        <span className="pair-full">
          English <SwapGlyph /> <span lang="ur">اردو</span>
        </span>
        <span className="pair-short" aria-hidden="true">
          EN <SwapGlyph /> UR
        </span>
      </p>

      <StatusIndicator status={status} />
    </header>
  )
}
