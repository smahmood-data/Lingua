import { useMemo } from 'react'
import { mixAccents } from '../languageAccents'
import type { UiState } from '../uiState'
import './Waveform.css'

const BAR_COUNT = 26
const CENTER = (BAR_COUNT - 1) / 2

/**
 * The voice line behind the microphone.
 *
 * There is deliberately no audio amplitude here: the capture pipeline does not
 * expose levels to the UI, and the working audio path is not ours to decorate.
 * The bars are instead a honest picture of *what the session is doing* —
 * breathing while it listens, traveling while it translates, pulsing outward
 * while it speaks — colored by the languages involved.
 */
export function Waveform({
  state,
  fromAccent,
  toAccent,
}: {
  state: UiState
  /** Accent of the language being spoken (pair's first side by default). */
  fromAccent: string
  /** Accent of the language being rendered. */
  toAccent: string
}) {
  const bars = useMemo(() => {
    return Array.from({ length: BAR_COUNT }, (_, index) => {
      const distance = Math.abs(index - CENTER)
      // A symmetric bell with a deterministic wobble: voice, not noise.
      const bell = Math.exp(-((distance / 5.4) ** 2))
      const wobble = 0.78 + 0.22 * (((index * 37) % 10) / 10)
      const height = Math.round(6 + 26 * bell * wobble)

      let color = 'var(--line-strong)'
      if (state === 'listening' || state === 'translating') {
        color = mixAccents(fromAccent, toAccent, index / (BAR_COUNT - 1))
      } else if (state === 'playing') {
        color = toAccent
      } else if (state === 'connecting' || state === 'stopping') {
        color = 'var(--ink-mute)'
      }

      return { index, distance, height, color }
    })
  }, [state, fromAccent, toAccent])

  return (
    <div
      className={`waveform wave-${state}`}
      aria-hidden="true"
      style={{ '--bar-count': BAR_COUNT } as React.CSSProperties}
    >
      {bars.map((bar) => (
        <span
          key={bar.index}
          className="wave-bar"
          style={
            {
              '--i': bar.index,
              '--d': bar.distance,
              '--h': `${bar.height}px`,
              '--c': bar.color,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
