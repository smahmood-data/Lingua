import type { AppStatus, ControlId } from '../types'

type Props = {
  status: AppStatus
  registerControl: (
    controlId: ControlId,
  ) => (element: HTMLElement | null) => void
  detailsRef: React.RefObject<HTMLDetailsElement | null>
  onStatusChange: (status: AppStatus) => void
  onSelectKeyDown: (event: React.KeyboardEvent<HTMLSelectElement>) => void
}

// Developer tooling for walking through every UI state without the API.
// Kept visually quiet so it never competes with the product experience.
export function DemoStates({
  status,
  registerControl,
  detailsRef,
  onStatusChange,
  onSelectKeyDown,
}: Props) {
  return (
    <details ref={detailsRef} className="demo-controls">
      <summary>Demo states</summary>
      <div className="demo-panel">
        <label htmlFor="demo-state">UI state</label>
        <select
          id="demo-state"
          ref={registerControl('demo')}
          value={status}
          onChange={(event) => onStatusChange(event.target.value as AppStatus)}
          onKeyDown={onSelectKeyDown}
        >
          <option value="ready">Ready</option>
          <option value="listening">Listening</option>
          <option value="loading">Loading</option>
          <option value="disconnected">Disconnected</option>
          <option value="denied">Microphone denied</option>
          <option value="error">API error</option>
        </select>
      </div>
    </details>
  )
}
