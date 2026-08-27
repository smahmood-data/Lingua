import { partnerLanguageMeta, type AppStatus, type PartnerLanguage } from '../types'
import { statusMeta } from '../data/mockTranscripts'
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

export function TopBar({
  status,
  partnerLanguage,
}: {
  status: AppStatus
  partnerLanguage: PartnerLanguage
}) {
  const partner = partnerLanguageMeta[partnerLanguage]

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
        aria-label={`Translating between English and ${partner.label}`}
      >
        <span className="pair-full">
          English <SwapGlyph />{' '}
          <span lang={partner.htmlLang}>{partner.nativeName}</span>
        </span>
        <span className="pair-short" aria-hidden="true">
          EN <SwapGlyph /> {partner.short}
        </span>
      </p>

      <StatusIndicator status={status} />
    </header>
  )
}
