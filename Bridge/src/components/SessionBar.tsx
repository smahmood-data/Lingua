import type { CSSProperties, Ref } from 'react'
import type { MicPhase } from './MicButton'
import './SessionBar.css'

const BARS_PER_SIDE = 14

function WaveBars({ side }: { side: 'left' | 'right' }) {
  return (
    <span className="wave-bars" data-side={side} aria-hidden="true">
      {Array.from({ length: BARS_PER_SIDE }, (_, index) => (
        <span
          key={index}
          style={
            {
              // Bars nearest the microphone lead; the line fades outward.
              '--bar': side === 'left' ? BARS_PER_SIDE - 1 - index : index,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function TrashGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.75 4.25h10.5M6.5 4.25V3.1a.85.85 0 0 1 .85-.85h1.3a.85.85 0 0 1 .85.85v1.15M4.25 4.25l.5 8.05a.9.9 0 0 0 .9.85h4.7a.9.9 0 0 0 .9-.85l.5-8.05"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type Props = {
  phase: Exclude<MicPhase, 'idle'>
  /** Language of the translation currently playing, for the caption. */
  playingLanguage?: string | null
  /** Accent color of that language, for the waveform and mic ring. */
  playingColor?: string | null
  /** The mic's docked home; the shell overlays the real mic on this slot. */
  dockSlotRef: Ref<HTMLDivElement>
  /** True while a start or stop the session has accepted is still in flight. */
  busy?: boolean
  onNewSession: () => void
  onClear: () => void
  newSessionRef?: Ref<HTMLButtonElement>
  clearRef?: Ref<HTMLButtonElement>
}

function captionFor(
  phase: Props['phase'],
  playingLanguage: string | null | undefined,
): string | null {
  switch (phase) {
    case 'connecting':
      return 'Connecting…'
    case 'listening':
      return 'Listening'
    case 'translating':
      return 'Translating…'
    case 'playing':
      return playingLanguage
        ? `Speaking ${playingLanguage}…`
        : 'Speaking the translation…'
    case 'ending':
      return 'Ending…'
    case 'ended':
      return 'Conversation ended · transcript kept'
    case 'error':
      return null
  }
}

/**
 * The conversation control: the docked microphone, flanked by a small
 * waveform while a session runs and by the two ways forward once it has
 * ended. It floats on the canvas behind a soft scrim — it is not a
 * compartment with a divider across the screen.
 *
 * Both flanks are always the same width, so the microphone stays on the
 * canvas's centre line whatever they contain.
 */
export function SessionBar({
  phase,
  playingLanguage,
  playingColor,
  dockSlotRef,
  busy,
  onNewSession,
  onClear,
  newSessionRef,
  clearRef,
}: Props) {
  const caption = captionFor(phase, playingLanguage)
  const finished = phase === 'ended' || phase === 'error'

  return (
    <footer
      className="session-bar"
      data-phase={phase}
      style={
        playingColor
          ? ({ '--playback-color': playingColor } as CSSProperties)
          : undefined
      }
    >
      <div className="session-mic-row">
        <div className="session-flank flank-left">
          {finished ? (
            <button
              type="button"
              className="session-action action-new"
              ref={newSessionRef}
              disabled={busy}
              onClick={onNewSession}
            >
              <PlusGlyph />
              New session
            </button>
          ) : (
            <WaveBars side="left" />
          )}
        </div>

        <div className="mic-slot mic-slot-dock" ref={dockSlotRef} />

        <div className="session-flank flank-right">
          {finished ? (
            <button
              type="button"
              className="session-action action-clear"
              ref={clearRef}
              onClick={onClear}
            >
              <TrashGlyph />
              Clear
            </button>
          ) : (
            <WaveBars side="right" />
          )}
        </div>
      </div>

      {caption ? (
        <p className="session-caption" role="status">
          {caption}
        </p>
      ) : null}
    </footer>
  )
}
