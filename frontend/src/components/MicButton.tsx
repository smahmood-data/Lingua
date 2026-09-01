import type { CSSProperties, Ref } from 'react'
import './MicButton.css'

/**
 * The session's resource state, as the mic presents it. `idle` is the large
 * hero treatment on the home canvas; every other phase is the docked control.
 */
export type MicPhase =
  | 'idle'
  | 'connecting'
  | 'ending'
  | 'listening'
  | 'translating'
  | 'playing'
  | 'ended'
  | 'error'

type Props = {
  phase: MicPhase
  /** Accent color of the language currently being spoken back. */
  accentColor?: string | null
  disabled?: boolean
  label: string
  buttonRef: Ref<HTMLButtonElement>
  onClick: () => void
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.25a4 4 0 0 1 0 5.5M17.75 7a7.25 7.25 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * The one microphone control. There is a single instance for the whole app:
 * the shell measures its hero slot on the idle canvas and its docked slot in
 * the session bar and moves it between them, so starting a conversation reads
 * as the microphone itself travelling rather than one control disappearing
 * and another taking its place.
 *
 * The icon changes only once, when Lingua starts speaking a translation back —
 * that is the one moment the control is doing something other than listening,
 * and the one moment worth showing.
 */
export function MicButton({
  phase,
  accentColor,
  disabled,
  label,
  buttonRef,
  onClick,
}: Props) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="mic-button"
      data-phase={phase}
      style={accentColor ? ({ '--mic-accent': accentColor } as CSSProperties) : undefined}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >
      <span className="mic-halo" aria-hidden="true" />
      <span className="mic-ring" aria-hidden="true" />
      <span className="mic-face">
        <span className="mic-glyph glyph-mic">
          <MicIcon />
        </span>
        <span className="mic-glyph glyph-speaker">
          <SpeakerIcon />
        </span>
      </span>
    </button>
  )
}
