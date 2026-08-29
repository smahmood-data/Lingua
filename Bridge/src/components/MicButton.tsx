import type { CSSProperties, Ref } from 'react'
import './MicButton.css'

/**
 * The session's resource state, as the mic presents it. `idle` is the large
 * hero treatment on the home canvas; every other phase is the docked control.
 */
export type MicPhase =
  | 'idle'
  | 'connecting'
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
  /** Position and size are owned by the shell's layout effect. */
  style?: CSSProperties
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

/**
 * The one microphone control. There is a single instance for the whole app:
 * the shell slides it between its hero slot on the idle canvas and its docked
 * slot in the session bar, so starting a conversation reads as the mic itself
 * travelling, not as one control vanishing and another appearing.
 */
export function MicButton({
  phase,
  accentColor,
  disabled,
  label,
  buttonRef,
  onClick,
  style,
}: Props) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="mic-button"
      data-phase={phase}
      style={{
        ...style,
        ...(accentColor ? { '--mic-accent': accentColor } : null),
      }}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >
      <span className="mic-face">
        <MicIcon />
      </span>
    </button>
  )
}
