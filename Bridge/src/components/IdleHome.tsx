import type { Ref } from 'react'
import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'
import { LanguageSelect } from './LanguageSelect'
import './IdleHome.css'

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

type Props = {
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  /** The hero mic's home; the shell overlays the real mic on this slot. */
  heroSlotRef: Ref<HTMLDivElement>
  onSelectSourceLanguage: (language: SourceLanguageCode) => void
  onSelectTargetLanguage: (language: SupportedLanguageCode) => void
  onSwapLanguages: () => void
  sourceSelectRef?: Ref<HTMLButtonElement>
  targetSelectRef?: Ref<HTMLButtonElement>
  swapRef?: Ref<HTMLButtonElement>
}

/**
 * The home canvas: the microphone as hero, a one-line invitation, and the
 * language pair living on the same screen. The pair is a conversation between
 * two languages, not a one-way route — hence the swap control between them.
 */
export function IdleHome({
  sourceLanguage,
  targetLanguage,
  heroSlotRef,
  onSelectSourceLanguage,
  onSelectTargetLanguage,
  onSwapLanguages,
  sourceSelectRef,
  targetSelectRef,
  swapRef,
}: Props) {
  const source =
    sourceLanguage === AUTO_SOURCE_LANGUAGE
      ? null
      : languageMetaFromCode(sourceLanguage)
  const target = languageMetaFromCode(targetLanguage)

  return (
    <div className="idle-home">
      <div className="idle-hero">
        <div className="mic-slot mic-slot-hero" ref={heroSlotRef} />
        <h2 className="idle-title">Ready when you are</h2>
        <p className="idle-subtitle">
          Press the microphone and speak naturally.{' '}
          {source ? (
            <>
              Lingua interprets between{' '}
              <span lang={source.htmlLang}>{source.label}</span> and{' '}
              <span lang={target.htmlLang}>{target.label}</span> in real time.
            </>
          ) : (
            'Lingua detects each speaker’s language and translates both ways in real time.'
          )}
        </p>
      </div>

      <div className="language-setup">
        <p className="language-setup-label">Language setup</p>
        <div className="language-selectors">
          <LanguageSelect
            label="From"
            value={sourceLanguage}
            allowAuto
            onChange={onSelectSourceLanguage}
            buttonRef={sourceSelectRef}
          />
          <button
            type="button"
            className="language-swap"
            ref={swapRef}
            onClick={onSwapLanguages}
            disabled={sourceLanguage === AUTO_SOURCE_LANGUAGE}
            aria-label="Swap languages"
            title={
              sourceLanguage === AUTO_SOURCE_LANGUAGE
                ? 'Choose a language to swap the pair'
                : 'Swap languages'
            }
          >
            <SwapGlyph />
          </button>
          <LanguageSelect
            label="To"
            value={targetLanguage}
            onChange={(code) => onSelectTargetLanguage(code as SupportedLanguageCode)}
            buttonRef={targetSelectRef}
          />
        </div>
        <p className="language-summary">
          {source?.label ?? 'Auto-detect'} ↔ {target.label}
          <span aria-hidden="true"> · </span>
          Ready for conversation
        </p>
      </div>
    </div>
  )
}
