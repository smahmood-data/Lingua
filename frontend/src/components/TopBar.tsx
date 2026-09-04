import type { CSSProperties } from 'react'
import { languageMetaFromCode, type SupportedLanguageCode } from '../types'
import { languageColor } from '../languageDisplay'
import type { Theme } from '../hooks/useTheme'
import { Wordmark } from './Wordmark'
import './TopBar.css'

function PairGlyph() {
  return (
    <svg
      className="pair-glyph"
      width="15"
      height="15"
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

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4M15.8 15.8l-1.4-1.4M5.6 5.6 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PairSide({
  code,
  fallback,
  side,
}: {
  code: SupportedLanguageCode | null
  /** Shown while Auto has not yet learned this side. */
  fallback: string
  side: 'start' | 'end'
}) {
  const meta = code ? languageMetaFromCode(code) : null
  return (
    <span
      className="pair-side"
      data-side={side}
      style={
        {
          '--pair-accent': code ? languageColor(code) : 'var(--line-strong)',
        } as CSSProperties
      }
    >
      <span className="pair-dot" aria-hidden="true" />
      <span lang={meta?.htmlLang || undefined}>{meta?.label ?? fallback}</span>
    </span>
  )
}

/**
 * The masthead is part of the canvas, not a bar across the top of it: no
 * divider, no background of its own, no status readout — state belongs with
 * the microphone. The wordmark is a single lockup in which the Arabic lām
 * *is* the L of Lingua, so the mark and the name are one thing.
 *
 * Once a conversation exists, the pair being interpreted sits beneath the
 * wordmark, hung off the exchange glyph so that glyph lands on the canvas's
 * centre line however long the two language names happen to be.
 */
export function TopBar({
  session,
  leftCode,
  rightCode,
  theme,
  onToggleTheme,
  onHistory,
}: {
  /** Whether a conversation is on screen (live, ended, or failed). */
  session: boolean
  /** The left side of the pair: the explicit or detected counterpart. */
  leftCode: SupportedLanguageCode | null
  rightCode: SupportedLanguageCode
  theme: Theme
  onToggleTheme: () => void
  onHistory?: () => void
}) {
  const left = leftCode ? languageMetaFromCode(leftCode) : null
  const right = languageMetaFromCode(rightCode)
  const dark = theme === 'dark'

  return (
    <header className="masthead">
      <Wordmark idle={!session} />

      {session ? (
        <p
          className="masthead-pair"
          aria-label={`Interpreting between ${left?.label ?? 'the detected language'} and ${right.label}`}
        >
          <PairSide code={leftCode} fallback="Detecting…" side="start" />
          <PairGlyph />
          <PairSide code={rightCode} fallback={right.label} side="end" />
        </p>
      ) : null}

      <div className="masthead-actions">
        {onHistory ? <button type="button" onClick={onHistory}>History</button> : null}
      </div>

      <button
        type="button"
        className="theme-toggle"
        onClick={onToggleTheme}
        aria-pressed={dark}
        aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  )
}
