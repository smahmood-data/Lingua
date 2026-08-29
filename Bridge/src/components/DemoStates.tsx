import type { UiState } from '../uiState'

type Props = {
  previewState: UiState | null
  onPreviewState: (state: UiState | null) => void
}

const PREVIEW_OPTIONS: { value: UiState; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'connecting', label: 'Connecting' },
  { value: 'listening', label: 'Listening' },
  { value: 'translating', label: 'Translating' },
  { value: 'playing', label: 'Playing' },
  { value: 'stopping', label: 'Stopping' },
  { value: 'permission', label: 'Microphone needed' },
  { value: 'disconnected', label: 'Disconnected' },
  { value: 'error', label: 'Error' },
]

// Developer tooling for walking through every UI state without the API.
// Kept visually quiet so it never competes with the product experience.
export function DemoStates({ previewState, onPreviewState }: Props) {
  return (
    <details className="demo-controls">
      <summary>Preview states</summary>
      <div className="demo-panel">
        <label htmlFor="demo-state">UI state</label>
        <select
          id="demo-state"
          value={previewState ?? ''}
          onChange={(event) => {
            const value = event.target.value
            onPreviewState(value === '' ? null : (value as UiState))
          }}
        >
          <option value="">Live session</option>
          {PREVIEW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </details>
  )
}
