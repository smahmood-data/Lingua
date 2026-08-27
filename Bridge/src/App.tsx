import { useEffect, useRef, useState } from 'react'
import './App.css'

// These are the only two directions supported by this demo.
type Direction = 'en-ur' | 'ur-en'

// The order here controls left/right keyboard navigation.
const directions: Direction[] = ['en-ur', 'ur-en']

// Controls are arranged like a small keyboard grid:
// direction buttons on the first row, microphone buttons on the second.
type ControlId = Direction | 'start' | 'stop' | 'demo'

const controlLayout: ControlId[][] = [
  ['en-ur', 'ur-en'],
  ['start', 'stop'],
]

const controlIds: ControlId[] = [
  'en-ur',
  'ur-en',
  'start',
  'stop',
  'demo',
]

function isControlDisabled(controlId: ControlId, isListening: boolean) {
  // A user cannot start while already listening, or stop while not listening.
  if (controlId === 'start') return isListening
  if (controlId === 'stop') return !isListening
  return false
}

type AppStatus =
  | 'ready'
  | 'listening'
  | 'loading'
  | 'disconnected'
  | 'denied'
  | 'error'

// Each mock line contains both what was spoken and its translation.
type TranscriptLine = {
  id: number
  speaker: string
  originalLanguage: 'English' | 'Urdu'
  translatedLanguage: 'English' | 'Urdu'
  original: string
  translated: string
}

// Keeping separate fixtures makes the direction buttons visibly change the demo.
const mockTranscripts: Record<Direction, TranscriptLine[]> = {
  'ur-en': [
    {
      id: 1,
      speaker: 'Speaker 1',
      originalLanguage: 'Urdu',
      translatedLanguage: 'English',
      original: 'ہیلو، کیا آپ میری مدد کر سکتے ہیں؟',
      translated: 'Hello, can you help me?',
    },
    {
      id: 2,
      speaker: 'Speaker 2',
      originalLanguage: 'English',
      translatedLanguage: 'Urdu',
      original: 'Yes, of course. What do you need?',
      translated: 'جی ہاں، ضرور۔ آپ کو کیا چاہیے؟',
    },
  ],
  'en-ur': [
    {
      id: 1,
      speaker: 'Speaker 1',
      originalLanguage: 'English',
      translatedLanguage: 'Urdu',
      original: 'Hello, can you help me?',
      translated: 'ہیلو، کیا آپ میری مدد کر سکتے ہیں؟',
    },
    {
      id: 2,
      speaker: 'Speaker 2',
      originalLanguage: 'Urdu',
      translatedLanguage: 'English',
      original: 'جی ہاں، ضرور۔ آپ کو کیا چاہیے؟',
      translated: 'Yes, of course. What do you need?',
    },
  ],
}

// The text shown in the status pill and in the state message.
const statusMessages: Record<AppStatus, string> = {
  ready: 'Ready to begin',
  listening: 'Microphone is listening',
  loading: 'Connecting to interpreter...',
  disconnected: 'Connection lost. Check your network.',
  denied: 'Microphone access was denied.',
  error: 'Something went wrong with translation.',
}

function App() {
  // State is data that can change while the app is running. Updating it rerenders the UI.
  const [direction, setDirection] = useState<Direction>('ur-en')
  const [status, setStatus] = useState<AppStatus>('ready')

  // Refs point to real DOM controls so keyboard navigation can move focus.
  const controlRefs = useRef<Record<ControlId, HTMLElement | null>>({
    'en-ur': null,
    'ur-en': null,
    start: null,
    stop: null,
    demo: null,
  })

  // Refs hold a value for the keyboard listener without needing to recreate it
  // every time the direction changes.
  const directionRef = useRef<Direction>('ur-en')

  // When returning from the demo menu, remember whether Start or Stop came first.
  const lastMicControlRef = useRef<'start' | 'stop'>('start')
  const demoDetailsRef = useRef<HTMLDetailsElement | null>(null)

  // These values are derived from direction rather than stored separately.
  const isListening = status === 'listening'

  const sourceLanguage = direction === 'en-ur' ? 'English' : 'Urdu'
  const targetLanguage = direction === 'en-ur' ? 'Urdu' : 'English'
  const mockTranscript = mockTranscripts[direction]

  function startInterpreter() {
    // This is mock behavior for now; a real app would request microphone access here.
    setStatus('listening')
  }

  function stopInterpreter() {
    setStatus('ready')
  }

  function selectDirection(nextDirection: Direction) {
    // Keep the ref and React state synchronized.
    directionRef.current = nextDirection
    setDirection(nextDirection)
  }

  function focusControl(controlId: ControlId) {
    // The demo select is inside a collapsible details element. Open it before
    // moving focus so keyboard navigation never focuses hidden content.
    if (controlId === 'demo') {
      const demoDetails = demoDetailsRef.current
      if (demoDetails) demoDetails.open = true
    }

    // Moving to a direction also selects it, which updates the transcript.
    if (controlId === 'en-ur' || controlId === 'ur-en') {
      selectDirection(controlId)
    }

    if (controlId === 'start' || controlId === 'stop') {
      lastMicControlRef.current = controlId
    }

    controlRefs.current[controlId]?.focus()
  }

  useEffect(() => {
    // Find which of our controls currently owns keyboard focus.
    function getFocusedControl(): ControlId | null {
      const focusedElement = document.activeElement

      return (
        controlIds.find(
          (controlId) => controlRefs.current[controlId] === focusedElement,
        ) ?? null
      )
    }

    function getNextControl(
      focusedControl: ControlId,
      key: string,
    ): ControlId | null {
      // The demo menu sits below both microphone controls.
      if (
        (focusedControl === 'start' || focusedControl === 'stop') &&
        key === 'ArrowDown'
      ) {
        lastMicControlRef.current = focusedControl
        return 'demo'
      }

      const rowIndex = controlLayout.findIndex((row) =>
        row.includes(focusedControl),
      )
      const row = controlLayout[rowIndex]
      const columnIndex = row.indexOf(focusedControl)

      if (key === 'Home') {
        return (
          row.find((controlId) => !isControlDisabled(controlId, isListening)) ??
          null
        )
      }

      if (key === 'End') {
        const enabledControls = row.filter(
          (controlId) => !isControlDisabled(controlId, isListening),
        )
        return enabledControls[enabledControls.length - 1] ?? null
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const nextColumn =
          columnIndex + (key === 'ArrowRight' ? 1 : -1)

        if (nextColumn < 0 || nextColumn >= row.length) return null

        const nextControl = row[nextColumn]
        return isControlDisabled(nextControl, isListening)
          ? null
          : nextControl
      }

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const nextRowIndex =
          rowIndex + (key === 'ArrowDown' ? 1 : -1)

        if (nextRowIndex < 0 || nextRowIndex >= controlLayout.length) {
          return null
        }

        const targetRow = controlLayout[nextRowIndex]
        const nextControl = targetRow[columnIndex]

        // If the same-column control is disabled, move to another enabled
        // control in the target row instead of leaving focus stranded.
        return (
          (nextControl && !isControlDisabled(nextControl, isListening)
            ? nextControl
            : targetRow.find(
                (controlId) => !isControlDisabled(controlId, isListening),
              )) ?? null
        )
      }

      return null
    }

    // This listener provides arrow-key navigation even if the mouse is elsewhere.
    function handleControlShortcut(event: globalThis.KeyboardEvent) {
      // Do not take over arrow keys inside form fields such as the state select.
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
          event.key,
        )
      ) {
        return
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }

      const focusedControl = getFocusedControl()
      let nextControl: ControlId | null = null

      if (focusedControl) {
        nextControl = getNextControl(focusedControl, event.key)
      } else if (event.key === 'ArrowDown') {
        const directionColumn = directions.indexOf(directionRef.current)
        const microphoneRow = controlLayout[1]
        const controlBelow = microphoneRow[directionColumn]
        nextControl =
          (controlBelow && !isControlDisabled(controlBelow, isListening)
            ? controlBelow
            : microphoneRow.find(
                (controlId) => !isControlDisabled(controlId, isListening),
              )) ?? null
      } else if (event.key === 'ArrowUp') {
        nextControl = directionRef.current
      } else {
        const currentIndex = directions.indexOf(directionRef.current)
        let nextIndex: number

        if (event.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % directions.length
        } else if (event.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + directions.length) % directions.length
        } else if (event.key === 'Home') {
          nextIndex = 0
        } else if (event.key === 'End') {
          nextIndex = directions.length - 1
        } else {
          return
        }

        nextControl = directions[nextIndex]
      }

      if (!nextControl || isControlDisabled(nextControl, isListening)) return

      event.preventDefault()

      // Focus the next control; focusControl also updates direction when needed.
      focusControl(nextControl)
    }

    window.addEventListener('keydown', handleControlShortcut)
    // Remove the listener when the component is cleaned up or listening changes.
    return () => window.removeEventListener('keydown', handleControlShortcut)
  }, [isListening])

  return (
    <main className="app-shell">
      {/* The header gives the user the app name and current microphone/API state. */}
      <header className="app-header">
        <div>
          <p className="eyebrow">LINGUA</p>
          <h1>Live Interpreter</h1>
        </div>

        <div className={`status-pill status-${status}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {statusMessages[status]}
        </div>
      </header>

      <section className="controls-card" aria-labelledby="controls-heading">
        <h2 id="controls-heading">Session controls</h2>

        <fieldset>
          <legend>Translation direction</legend>

          {/* These buttons select the direction and are also keyboard navigable. */}
          <div className="direction-buttons">
            <button
              type="button"
              ref={(button) => {
                controlRefs.current['en-ur'] = button
              }}
              data-direction="en-ur"
              className={direction === 'en-ur' ? 'active' : ''}
              aria-pressed={direction === 'en-ur'}
              onClick={() => selectDirection('en-ur')}
            >
              English <span aria-hidden="true">→</span> Urdu
            </button>

            <button
              type="button"
              ref={(button) => {
                controlRefs.current['ur-en'] = button
              }}
              data-direction="ur-en"
              className={direction === 'ur-en' ? 'active' : ''}
              aria-pressed={direction === 'ur-en'}
              onClick={() => selectDirection('ur-en')}
            >
              Urdu <span aria-hidden="true">→</span> English
            </button>
          </div>

          <p className="keyboard-hint">
            Use ← or → to switch direction, and ↑ or ↓ to move between
            controls. Home and End jump within a row. Press Enter or Space to
            confirm. From a microphone control, ↓ opens the demo state menu.
          </p>
        </fieldset>

        {/* The microphone actions are the second row in the keyboard control grid. */}
        <div className="control-actions">
          <button
            type="button"
            ref={(button) => {
              controlRefs.current.start = button
            }}
            className="start-button"
            onClick={startInterpreter}
            disabled={isListening}
          >
            Start microphone
          </button>

          <button
            type="button"
            ref={(button) => {
              controlRefs.current.stop = button
            }}
            className="stop-button"
            onClick={stopInterpreter}
            disabled={!isListening}
          >
            Stop
          </button>
        </div>

        {/* Temporary controls let us demonstrate required states without an API. */}
        <details
          ref={demoDetailsRef}
          className="demo-controls"
        >
          <summary>Demo state testing</summary>

          <label>
            Choose a state:
            <select
              ref={(select) => {
                controlRefs.current.demo = select
              }}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as AppStatus)
              }
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                }

                if (
                  event.key === 'ArrowUp' &&
                  event.currentTarget.selectedIndex === 0
                ) {
                  event.preventDefault()
                  if (demoDetailsRef.current) {
                    demoDetailsRef.current.open = false
                  }

                  const previousControl = isControlDisabled(
                    lastMicControlRef.current,
                    isListening,
                  )
                    ? isListening
                      ? 'stop'
                      : 'start'
                    : lastMicControlRef.current

                  focusControl(previousControl)
                }
              }}
            >
              <option value="ready">Ready</option>
              <option value="listening">Listening</option>
              <option value="loading">Loading</option>
              <option value="disconnected">Disconnected</option>
              <option value="denied">Microphone denied</option>
              <option value="error">API error</option>
            </select>
          </label>
        </details>
      </section>

      {status !== 'ready' && status !== 'listening' && (
        // Only non-normal states need an additional explanatory message.
        <div
          className={`state-message state-message-${status}`}
          role={status === 'error' || status === 'denied' ? 'alert' : 'status'}
        >
          {statusMessages[status]}
        </div>
      )}

      <section className="transcript-card" aria-labelledby="transcript-heading">
        <div className="transcript-header">
          <div>
            <p className="eyebrow">TRANSCRIPT</p>
            <h2 id="transcript-heading">Conversation</h2>
          </div>

          <p className="language-summary">
            {sourceLanguage} → {targetLanguage}
          </p>
        </div>

        <div className="transcript-list">
          {/* The mock data stands in for future microphone/API events. */}
          {mockTranscript.map((line) => {
            return (
              <article className="transcript-line" key={line.id}>
                <div className="line-label">
                  <span>
                    {line.speaker} - {line.originalLanguage}
                  </span>
                </div>

                <p
                  className={`subtitle ${
                    line.originalLanguage === 'Urdu' ? 'urdu-text' : ''
                  }`}
                >
                  {line.original}
                </p>

                <div className="line-label translation-label">
                  <span>{line.translatedLanguage} translation</span>
                </div>

                <p
                  className={`subtitle translated-subtitle ${
                    line.translatedLanguage === 'Urdu' ? 'urdu-text' : ''
                  }`}
                >
                  {line.translated}
                </p>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default App
