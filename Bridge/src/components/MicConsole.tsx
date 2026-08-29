import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'
import { languageAccent, type LanguageAccent } from '../languageAccents'
import {
  consoleCopy,
  micActionLabel,
  micIsBusy,
  type UiState,
} from '../uiState'
import { LanguagePairSelector } from './LanguagePairSelector'
import { Waveform } from './Waveform'
import { DemoStates } from './DemoStates'
import './MicConsole.css'

type Props = {
  state: UiState
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  detectedLanguage: SupportedLanguageCode | null
  /** The pair's accents, already collision-nudged by the caller. */
  pairAccents: readonly [LanguageAccent, LanguageAccent]
  /** Language of the turn in progress, once identified. */
  liveSource: string | null
  /** Language the turn in progress is being rendered into. */
  liveTarget: string | null
  onActivate: () => void
  onSelectSourceLanguage: (language: SourceLanguageCode) => void
  onSelectTargetLanguage: (language: SupportedLanguageCode) => void
  previewState: UiState | null
  onPreviewState: (state: UiState | null) => void
}

function MicIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function InterpretIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5h11m0 0-3-3m3 3-3 3M20 15.5H9m0 0 3-3m-3 3 3 3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.25a4 4 0 0 1 0 5.5M17.75 7a7.25 7.25 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 54

/**
 * The console: pair selector, the microphone itself, and what Lingua is doing.
 * The microphone is the only way a session starts or ends — one control whose
 * appearance always matches the session's own state.
 */
export function MicConsole({
  state,
  sourceLanguage,
  targetLanguage,
  detectedLanguage,
  pairAccents,
  liveSource,
  liveTarget,
  onActivate,
  onSelectSourceLanguage,
  onSelectTargetLanguage,
  previewState,
  onPreviewState,
}: Props) {
  const isAuto = sourceLanguage === AUTO_SOURCE_LANGUAGE
  const [pairA, pairB] = pairAccents

  // While a turn is live, its actual direction owns the accents.
  const fromAccent = liveSource ? languageAccent(liveSource).strong : pairA.strong
  const toAccent = liveTarget ? languageAccent(liveTarget).strong : pairB.strong

  const copy = consoleCopy(state, {
    source: isAuto ? null : languageMetaFromCode(sourceLanguage).label,
    target: languageMetaFromCode(targetLanguage).label,
    detected: detectedLanguage
      ? languageMetaFromCode(detectedLanguage).label
      : null,
    liveTarget: liveTarget ? languageMetaFromCode(liveTarget).label : null,
  })

  const busy = micIsBusy(state)

  return (
    <section className="console" aria-label="Interpreter console">
      <LanguagePairSelector
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        detectedLanguage={detectedLanguage}
        sourceAccent={pairA}
        targetAccent={pairB}
        onSelectSourceLanguage={onSelectSourceLanguage}
        onSelectTargetLanguage={onSelectTargetLanguage}
      />

      <div
        className={`mic-stage mic-${state}`}
        style={
          {
            '--orb-a': pairA.strong,
            '--orb-b': pairB.strong,
            '--orb-from': fromAccent,
            '--orb-to': toAccent,
          } as React.CSSProperties
        }
      >
        <Waveform state={state} fromAccent={fromAccent} toAccent={toAccent} />

        <div className="orb-wrap">
          <svg
            className="orb-ring"
            viewBox="0 0 120 120"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="pair-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={pairA.strong} />
                <stop offset="100%" stopColor={pairB.strong} />
              </linearGradient>
            </defs>
            <circle
              className="orb-ring-circle"
              cx="60"
              cy="60"
              r="54"
              fill="none"
              strokeWidth="2.5"
              strokeDasharray={state === 'connecting' ? `84 ${RING_CIRCUMFERENCE - 84}` : undefined}
              strokeLinecap="round"
            />
          </svg>

          {state === 'playing' ? (
            <>
              <span className="orb-ripple" aria-hidden="true" />
              <span className="orb-ripple ripple-late" aria-hidden="true" />
            </>
          ) : null}

          <button
            type="button"
            className="orb"
            onClick={onActivate}
            disabled={busy}
            aria-label={micActionLabel(state)}
          >
            <span className="orb-icon icon-mic" aria-hidden="true">
              <MicIcon />
            </span>
            <span className="orb-icon icon-interpret" aria-hidden="true">
              <InterpretIcon />
            </span>
            <span className="orb-icon icon-speaker" aria-hidden="true">
              <SpeakerIcon />
            </span>
          </button>

          {state === 'permission' || state === 'disconnected' || state === 'error' ? (
            <span className="orb-badge" aria-hidden="true">
              !
            </span>
          ) : null}
        </div>
      </div>

      <p className="console-status" role="status" aria-live="polite">
        <span className="status-primary">{copy.primary}</span>
        <span className="status-helper">{copy.helper ?? ''}</span>
      </p>

      <div className="console-utility">
        <DemoStates previewState={previewState} onPreviewState={onPreviewState} />
      </div>
    </section>
  )
}
