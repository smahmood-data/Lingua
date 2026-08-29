import { languageMetaFromCode, type SupportedLanguageCode } from '../types'
import { languageColor } from '../languageDisplay'
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
        d="M2.5 5.5h10m0 0-2.5-2.5m2.5 2.5L10 8M13.5 10.5h-10m0 0L6 8m-2.5 2.5L6 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The header is part of the same canvas as everything else: the lām-anchored
 * wordmark on the left, and — only while a conversation exists — the session
 * context and the language pair it is interpreting. No status readout, no
 * divider: state lives with the microphone, not in a dashboard strip.
 */
export function TopBar({
  session,
  leftCode,
  rightCode,
}: {
  /** Whether a conversation is on screen (active, ended, or failed). */
  session: boolean
  /** The left side of the pair: the explicit or detected counterpart. */
  leftCode: SupportedLanguageCode | null
  rightCode: SupportedLanguageCode
}) {
  const left = leftCode ? languageMetaFromCode(leftCode) : null
  const right = languageMetaFromCode(rightCode)

  return (
    <header className="topbar">
      <div className="brand">
        {/* lām — the "L" of Lingua — set in its own script, unboxed. */}
        <span className="brand-mark" aria-hidden="true" lang="ar">
          ل
        </span>
        <h1 className="brand-name">Lingua</h1>
      </div>

      {session ? (
        <>
          <p className="topbar-context">Live Conversation</p>
          <p
            className="topbar-pair"
            aria-label={`${left?.label ?? 'Auto-detect'} and ${right.label} two-way translation`}
          >
            <span
              className="pair-dot"
              style={{
                background: leftCode
                  ? languageColor(leftCode)
                  : 'var(--ink-mute)',
              }}
              aria-hidden="true"
            />
            <span lang={left?.htmlLang || undefined}>
              {left?.label ?? 'Auto-detect'}
            </span>
            <SwapGlyph />
            <span
              className="pair-dot"
              style={{ background: languageColor(rightCode) }}
              aria-hidden="true"
            />
            <span lang={right.htmlLang}>{right.label}</span>
          </p>
        </>
      ) : null}
    </header>
  )
}
