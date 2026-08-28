import {
  languageMetaFromCode,
  type AppStatus,
  type SupportedLanguageCode,
} from '../types'
import { statusMeta } from '../data/mockTranscripts'
import './TopBar.css'

function RouteGlyph() {
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
        d="M2.5 8h10m0 0-3-3m3 3-3 3"
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

export function TopBar({
  status,
  targetLanguage,
}: {
  status: AppStatus
  targetLanguage: SupportedLanguageCode
}) {
  const target = languageMetaFromCode(targetLanguage)

  return (
    <header className="topbar">
      <div className="brand">
        {/* lām — the "L" of Lingua — anchors the wordmark */}
        <span className="brand-mark" aria-hidden="true" lang="ar">
          ل
        </span>
        <h1 className="brand-name">Lingua</h1>
      </div>

      <p
        className="language-pair"
        aria-label={`Automatically detecting speech and translating into ${target.label}`}
      >
        <span className="pair-full">
          Auto-detect <RouteGlyph />{' '}
          <span lang={target.htmlLang}>{target.label}</span>
        </span>
        <span className="pair-short" aria-hidden="true">
          Auto <RouteGlyph /> {target.code.toUpperCase()}
        </span>
      </p>

      <StatusIndicator status={status} />
    </header>
  )
}
