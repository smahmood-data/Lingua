import { statusChipLabel, type UiState } from '../uiState'
import './TopBar.css'

function chipTone(state: UiState): string {
  switch (state) {
    case 'listening':
    case 'translating':
      return 'active'
    case 'playing':
      return 'speaking'
    case 'connecting':
    case 'stopping':
      return 'busy'
    case 'permission':
      return 'warning'
    case 'disconnected':
    case 'error':
      return 'danger'
    default:
      return 'idle'
  }
}

export function TopBar({ state }: { state: UiState }) {
  const tone = chipTone(state)
  return (
    <header className="topbar">
      <div className="brand">
        {/* lām — the "L" of Lingua — anchors the wordmark */}
        <span className="brand-mark" aria-hidden="true" lang="ar">
          ل
        </span>
        <h1 className="brand-name">Lingua</h1>
      </div>

      <p
        className={`status-chip chip-${tone}`}
        role="status"
        aria-label={`Status: ${statusChipLabel(state)}`}
      >
        <span className="chip-dot" aria-hidden="true" />
        <span className="chip-label">{statusChipLabel(state)}</span>
      </p>
    </header>
  )
}
