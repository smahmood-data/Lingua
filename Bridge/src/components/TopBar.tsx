import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  type AppStatus,
  type SourceLanguageCode,
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
        d="M2.5 5.5h10m0 0-2.5-2.5m2.5 2.5L10 8M13.5 10.5h-10m0 0L6 8m-2.5 2.5L6 13"
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
  sourceLanguage,
  targetLanguage,
}: {
  status: AppStatus
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
}) {
  const source =
    sourceLanguage === AUTO_SOURCE_LANGUAGE
      ? null
      : languageMetaFromCode(sourceLanguage)
  const target = languageMetaFromCode(targetLanguage)
  const sourceLabel = source?.label ?? 'Auto-detect'

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
        aria-label={`${sourceLabel} and ${target.label} two-way translation`}
      >
        <span className="pair-full">
          {sourceLabel} <RouteGlyph />{' '}
          <span lang={target.htmlLang}>{target.label}</span>
        </span>
        <span className="pair-short" aria-hidden="true">
          {source?.code.toUpperCase() ?? 'Auto'} <RouteGlyph />{' '}
          {target.code.toUpperCase()}
        </span>
      </p>

      <StatusIndicator status={status} />
    </header>
  )
}
