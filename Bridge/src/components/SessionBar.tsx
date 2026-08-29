import type { CSSProperties, Ref } from 'react'
import type { MicPhase } from './MicButton'
import './SessionBar.css'

const BARS_PER_SIDE = 6

function WaveBars({ mirrored }: { mirrored?: boolean }) {
  return (
    <span
      className={`wave-bars${mirrored ? ' wave-bars-mirror' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: BARS_PER_SIDE }, (_, index) => (
        <span key={index} style={{ '--bar': index } as CSSProperties} />
      ))}
    </span>
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
      return 'Listening… Speak naturally.'
    case 'translating':
      return 'Translating…'
    case 'playing':
      return playingLanguage
        ? `Playing the ${playingLanguage} translation…`
        : 'Playing the translation…'
    case 'ended':
      return 'Session ended · Transcript retained'
    case 'error':
      return null
  }
}

/**
 * The persistent conversation control strip: the docked microphone flanked by
 * a small waveform, a one-line account of what Lingua is doing, and — once a
 * conversation has ended — the two ways forward. It floats on the canvas; it
 * is not a compartment with a divider.
 */
export function SessionBar({
  phase,
  playingLanguage,
  playingColor,
  dockSlotRef,
  onNewSession,
  onClear,
  newSessionRef,
  clearRef,
}: Props) {
  const caption = captionFor(phase, playingLanguage)
  const active =
    phase === 'listening' || phase === 'translating' || phase === 'playing'

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
        {active ? <WaveBars /> : null}
        <div className="mic-slot mic-slot-dock" ref={dockSlotRef} />
        {active ? <WaveBars mirrored /> : null}
      </div>

      {caption ? (
        <p className="session-caption" role="status">
          {caption}
        </p>
      ) : null}

      {phase === 'ended' || phase === 'error' ? (
        <div className="session-actions">
          <button
            type="button"
            className="session-action action-new"
            ref={newSessionRef}
            onClick={onNewSession}
          >
            New session
          </button>
          <span className="actions-divider" aria-hidden="true" />
          <button
            type="button"
            className="session-action action-clear"
            ref={clearRef}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      ) : null}
    </footer>
  )
}
