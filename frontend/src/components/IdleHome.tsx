import { useState, type Ref } from 'react'
import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'
import { LanguageSelect } from './LanguageSelect'
import './IdleHome.css'

/*
  The same greeting every time reads like a sign rather than an invitation.
  One is chosen when the home canvas mounts — a fresh visit, or returning here
  after clearing a conversation — and then held, so nothing swaps under the
  reader's eyes. They are the same length and tone on purpose: the line sits
  above the language pair, and the layout must not move between them.
*/
const GREETINGS = [
  'Ready when you are',
  'Whenever you’re ready',
  'Start when you’re ready',
  'Speak when you’re ready',
  'Begin when you’re ready',
  'Ready to begin',
  'Start whenever you like',
  'Begin whenever you like',
  'Whenever you’re set',
  'When you’re ready',
  'Take your time',
  'Go ahead',
  'Your turn',
  'Ready whenever you are',
] as const

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
 * The home canvas: the microphone as hero, a single line inviting you to use
 * it, and the language pair on the same screen rather than behind a setup
 * step. The pair is a conversation between two languages, not a one-way
 * route — hence the swap between them.
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
  const autoSource = sourceLanguage === AUTO_SOURCE_LANGUAGE
  const [greeting] = useState(
    () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)],
  )

  return (
    <div className="idle-home">
      <div className="idle-hero">
        <div className="mic-slot mic-slot-hero" ref={heroSlotRef} />
        <h2 className="idle-title">{greeting}</h2>
        <p className="idle-subtitle">
          {source ? (
            <>
              Tap the microphone and speak — Lingua interprets between{' '}
              <span lang={source.htmlLang}>{source.label}</span> and{' '}
              <span lang={target.htmlLang}>{target.label}</span>, both ways.
            </>
          ) : (
            <>
              Tap the microphone and speak — Lingua hears the language, and
              interprets it into <span lang={target.htmlLang}>{target.label}</span>.
            </>
          )}
        </p>
      </div>

      <div className="language-setup">
        <LanguageSelect
          label="Speak or detect language"
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
          disabled={autoSource}
          aria-label="Swap the two languages"
          title={
            autoSource
              ? 'Choose a language to swap the pair'
              : 'Swap the two languages'
          }
        >
          <SwapGlyph />
        </button>
        <LanguageSelect
          label="Language to translate into"
          value={targetLanguage}
          onChange={(code) =>
            onSelectTargetLanguage(code as SupportedLanguageCode)
          }
          buttonRef={targetSelectRef}
        />
      </div>
    </div>
  )
}
