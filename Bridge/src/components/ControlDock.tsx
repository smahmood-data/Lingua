import type { AppStatus, ControlId, Direction } from '../types'
import { DemoStates } from './DemoStates'
import './ControlDock.css'

type Props = {
  direction: Direction
  status: AppStatus
  isListening: boolean
  registerControl: (
    controlId: ControlId,
  ) => (element: HTMLElement | null) => void
  demoDetailsRef: React.RefObject<HTMLDetailsElement | null>
  onSelectDirection: (direction: Direction) => void
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

// The dock keeps the two decisions that matter — which direction is live,
// and whether the conversation is running — reachable at all times.
export function ControlDock({
  direction,
  status,
  isListening,
  registerControl,
  demoDetailsRef,
  onSelectDirection,
  onStart,
  onStop,
  onStatusChange,
  onDemoSelectKeyDown,
}: Props) {
  return (
    <section className="dock" aria-label="Conversation controls">
      <div className="dock-row">
        <fieldset className="direction-field">
          <legend>Now translating</legend>
          <div className="segmented">
            <button
              type="button"
              ref={registerControl('en-ur')}
              data-direction="en-ur"
              className={`segment ${direction === 'en-ur' ? 'segment-active' : ''}`}
              aria-pressed={direction === 'en-ur'}
              onClick={() => onSelectDirection('en-ur')}
            >
              English <span aria-hidden="true">→</span> Urdu
            </button>
            <button
              type="button"
              ref={registerControl('ur-en')}
              data-direction="ur-en"
              className={`segment ${direction === 'ur-en' ? 'segment-active' : ''}`}
              aria-pressed={direction === 'ur-en'}
              onClick={() => onSelectDirection('ur-en')}
            >
              Urdu <span aria-hidden="true">→</span> English
            </button>
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
          <kbd>←</kbd> <kbd>→</kbd> direction <span aria-hidden="true">·</span>{' '}
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
