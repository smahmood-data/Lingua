import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  supportedLanguages,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'
import { languageAccent, type LanguageAccent } from '../languageAccents'
import './LanguagePairSelector.css'

type Props = {
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  /** The counterpart Auto has detected, when it has. */
  detectedLanguage: SupportedLanguageCode | null
  /** Accents chosen for the pair, already collision-nudged. */
  sourceAccent: LanguageAccent
  targetAccent: LanguageAccent
  onSelectSourceLanguage: (language: SourceLanguageCode) => void
  onSelectTargetLanguage: (language: SupportedLanguageCode) => void
}

function SwapGlyph() {
  return (
    <svg
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

function ChevronGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="m3 4.5 3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * One chip = one side of the pair. The native select is stretched invisibly
 * over the chip, so the control keeps native keyboard, touch, and screen-reader
 * behavior while looking like the product.
 */
function LanguageChip({
  value,
  accent,
  ariaLabel,
  includeAuto,
  onChange,
}: {
  value: string
  accent: LanguageAccent
  ariaLabel: string
  includeAuto?: boolean
  onChange: (value: string) => void
}) {
  const meta =
    value === AUTO_SOURCE_LANGUAGE ? null : languageMetaFromCode(value)
  return (
    <label
      className="lang-chip"
      style={{ '--chip-accent': accent.strong } as React.CSSProperties}
    >
      <span className="chip-lang-dot" aria-hidden="true" />
      <span className="chip-name" lang={meta?.htmlLang || undefined}>
        {meta?.label ?? 'Auto'}
      </span>
      <span className="chip-chevron" aria-hidden="true">
        <ChevronGlyph />
      </span>
      <select
        className="chip-select"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {includeAuto ? (
          <option value={AUTO_SOURCE_LANGUAGE}>Auto-detect</option>
        ) : null}
        {supportedLanguages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// The pair is bidirectional: either person may speak first, in either language.
export function LanguagePairSelector({
  sourceLanguage,
  targetLanguage,
  detectedLanguage,
  sourceAccent,
  targetAccent,
  onSelectSourceLanguage,
  onSelectTargetLanguage,
}: Props) {
  const isAuto = sourceLanguage === AUTO_SOURCE_LANGUAGE
  const detected =
    isAuto && detectedLanguage ? languageMetaFromCode(detectedLanguage) : null

  return (
    <div className="pair-select">
      <div
        className="pair-chips"
        role="group"
        aria-label="Language pair for two-way interpretation"
      >
        <LanguageChip
          value={sourceLanguage}
          accent={sourceAccent}
          ariaLabel="First language, or Auto-detect"
          includeAuto
          onChange={(value) =>
            onSelectSourceLanguage(value as SourceLanguageCode)
          }
        />
        <span className="pair-swap" aria-hidden="true">
          <SwapGlyph />
        </span>
        <LanguageChip
          value={targetLanguage}
          accent={targetAccent}
          ariaLabel="Language to interpret into"
          onChange={(value) =>
            onSelectTargetLanguage(value as SupportedLanguageCode)
          }
        />
      </div>
      {/* Height is reserved so detection never shifts the console layout. */}
      <p className="pair-detected" aria-live="polite">
        {detected ? (
          <>
            <span
              className="detected-dot"
              style={{
                background: languageAccent(detectedLanguage!).strong,
              }}
              aria-hidden="true"
            />
            Hearing <span lang={detected.htmlLang}>{detected.label}</span>
          </>
        ) : null}
      </p>
    </div>
  )
}
