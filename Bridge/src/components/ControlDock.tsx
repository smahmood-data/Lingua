import {
  AUTO_SOURCE_LANGUAGE,
  supportedLanguages,
  type AppStatus,
  type ControlId,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'
import { DemoStates } from './DemoStates'
import './ControlDock.css'

type Props = {
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  status: AppStatus
  isListening: boolean
  registerControl: (
    controlId: ControlId,
  ) => (element: HTMLElement | null) => void
  demoDetailsRef: React.RefObject<HTMLDetailsElement | null>
  onSelectSourceLanguage: (language: SourceLanguageCode) => void
  onSelectTargetLanguage: (language: SupportedLanguageCode) => void
  onStart: () => void
  onStop: () => void
  onStatusChange: (status: AppStatus) => void
  onDemoSelectKeyDown: (event: React.KeyboardEvent<HTMLSelectElement>) => void
}

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

// The dock keeps the output language and microphone controls reachable.
export function ControlDock({
  sourceLanguage,
  targetLanguage,
  status,
  isListening,
  registerControl,
  demoDetailsRef,
  onSelectSourceLanguage,
  onSelectTargetLanguage,
  onStart,
  onStop,
  onStatusChange,
  onDemoSelectKeyDown,
}: Props) {
  return (
    <section className="dock" aria-label="Conversation controls">
      <div className="dock-row">
        <fieldset className="direction-field">
          <legend>Translation languages</legend>
          <div className="language-route">
            <label className="language-source">
              <span className="language-source-label">From</span>
              <select
                ref={registerControl('source-language')}
                value={sourceLanguage}
                onChange={(event) =>
                  onSelectSourceLanguage(
                    event.target.value as SourceLanguageCode,
                  )
                }
              >
                <option value={AUTO_SOURCE_LANGUAGE}>Auto-detect</option>
                {supportedLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="language-arrow" aria-hidden="true">
              ⇄
            </span>
            <label className="language-target">
              <span className="language-target-label">Translate into</span>
              <select
                ref={registerControl('target-language')}
                value={targetLanguage}
                onChange={(event) =>
                  onSelectTargetLanguage(
                    event.target.value as SupportedLanguageCode,
                  )
                }
              >
                {supportedLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <div className="dock-actions">
          <button
            type="button"
            ref={registerControl('start')}
            className="btn btn-primary"
            onClick={onStart}
            disabled={isListening}
          >
            <MicIcon />
            Start conversation
          </button>
          <button
            type="button"
            ref={registerControl('stop')}
            className="btn btn-end"
            onClick={onStop}
            disabled={!isListening}
          >
            End
          </button>
        </div>
      </div>

      <div className="dock-subrow">
        <p className="keyboard-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> controls <span aria-hidden="true">·</span>{' '}
          <kbd>Enter</kbd> to select
        </p>
        <DemoStates
          status={status}
          registerControl={registerControl}
          detailsRef={demoDetailsRef}
          onStatusChange={onStatusChange}
          onSelectKeyDown={onDemoSelectKeyDown}
        />
      </div>
    </section>
  )
}
