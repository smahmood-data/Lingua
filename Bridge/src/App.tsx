import { useCallback, useMemo, useRef, useState } from 'react'
import { ControlDock } from './components/ControlDock'
import { StatusNotice } from './components/StatusNotice'
import { TopBar } from './components/TopBar'
import { Transcript } from './components/Transcript'
import { mockTranscripts } from './data/mockTranscripts'
import { useControlKeyboard } from './hooks/useControlKeyboard'
import {
  controlIds,
  type AppStatus,
  type ControlId,
  type Direction,
} from './types'
import './App.css'

function App() {
  // State is data that can change while the app is running. Updating it rerenders the UI.
  const [direction, setDirection] = useState<Direction>('ur-en')
  const [status, setStatus] = useState<AppStatus>('ready')

  // Refs point to real DOM controls so keyboard navigation can move focus.
  // Callbacks are created here so child components never mutate the ref map.
  const controlRefs = useRef<Record<ControlId, HTMLElement | null>>({
    'en-ur': null,
    'ur-en': null,
    start: null,
    stop: null,
    demo: null,
  })
  const demoDetailsRef = useRef<HTMLDetailsElement | null>(null)

  const registerControl = useMemo(() => {
    const callbacks = {} as Record<
      ControlId,
      (element: HTMLElement | null) => void
    >
    for (const controlId of controlIds) {
      callbacks[controlId] = (element) => {
        controlRefs.current[controlId] = element
      }
    }
    return (controlId: ControlId) => callbacks[controlId]
  }, [])

  // These values are derived from direction rather than stored separately.
  const isListening = status === 'listening'
  const sourceLanguage = direction === 'en-ur' ? 'English' : 'Urdu'
  const mockTranscript = mockTranscripts[direction]

  const selectDirection = useCallback((nextDirection: Direction) => {
    setDirection(nextDirection)
  }, [])

  const { handleDemoSelectKeyDown } = useControlKeyboard({
    direction,
    isListening,
    onSelectDirection: selectDirection,
    controlRefs,
    demoDetailsRef,
  })

  function startInterpreter() {
    // This is mock behavior for now; the audio issues (#2/#3) will request
    // the microphone and open the Live session here instead.
    setStatus('listening')
  }

  function stopInterpreter() {
    setStatus('ready')
  }

  return (
    <div className="app-shell">
      <TopBar status={status} />

      <main className="app-main">
        <StatusNotice status={status} />
        <Transcript
          status={status}
          lines={mockTranscript}
          sourceLanguage={sourceLanguage}
        />
      </main>

      <ControlDock
        direction={direction}
        status={status}
        isListening={isListening}
        registerControl={registerControl}
        demoDetailsRef={demoDetailsRef}
        onSelectDirection={selectDirection}
        onStart={startInterpreter}
        onStop={stopInterpreter}
        onStatusChange={setStatus}
        onDemoSelectKeyDown={handleDemoSelectKeyDown}
      />
    </div>
  )
}

export default App
