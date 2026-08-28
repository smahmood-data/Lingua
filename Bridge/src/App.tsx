import { useCallback, useMemo, useRef, useState } from 'react'
import { ControlDock } from './components/ControlDock'
import { StatusNotice } from './components/StatusNotice'
import { TopBar } from './components/TopBar'
import { Transcript } from './components/Transcript'
import { mockTranscripts } from './data/mockTranscripts'
import { useControlKeyboard } from './hooks/useControlKeyboard'
import { useTranslationSession } from './hooks/useTranslationSession'
import type { SessionError, SessionState, TranscriptTurn } from './lib/translation'
import {
  controlIds,
  languageMetaFromCode,
  type AppStatus,
  type ControlId,
  type SupportedLanguageCode,
  type TranscriptLine,
} from './types'
import './App.css'

function toAppStatus(
  state: SessionState,
  error: SessionError | null,
): AppStatus {
  if (error?.code === 'microphone-permission-denied') return 'denied'
  if (error?.code === 'live-disconnected') return 'disconnected'
  if (state === 'error') return 'error'
  if (state === 'connecting') return 'loading'
  if (state === 'listening' || state === 'translating') return 'listening'
  return 'ready'
}

function toTranscriptLines(
  turns: TranscriptTurn[],
  targetLanguage: SupportedLanguageCode,
): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  let pendingSource: TranscriptTurn | null = null
  let id = 1

  const pushLine = (
    source: TranscriptTurn | null,
    translation: TranscriptTurn | null,
  ) => {
    const spoken = source ?? translation
    if (!spoken) return

    const originalLanguage = languageMetaFromCode(
      source?.languageCode ?? spoken.languageCode,
    )
    const translatedLanguage = translation
      ? languageMetaFromCode(translation.languageCode)
      : languageMetaFromCode(targetLanguage)

    lines.push({
      id,
      speaker: `${originalLanguage.label} speaker`,
      originalLanguage: originalLanguage.label,
      originalLanguageCode: originalLanguage.code,
      translatedLanguage: translatedLanguage.label,
      translatedLanguageCode: translatedLanguage.code,
      original: source?.text ?? '',
      translated: translation?.text ?? '',
    })
    id += 1
  }

  for (const turn of turns) {
    if (turn.kind === 'source') {
      if (pendingSource) pushLine(pendingSource, null)
      pendingSource = turn
      continue
    }
    pushLine(pendingSource, turn)
    pendingSource = null
  }

  if (pendingSource) pushLine(pendingSource, null)
  return lines
}

function App() {
  const {
    state,
    error,
    transcript,
    interimTranscript,
    isActive,
    targetLanguage,
    start,
    setTargetLanguage,
    stop,
  } = useTranslationSession()

  const [previewStatus, setPreviewStatus] = useState<AppStatus | null>(null)
  const liveStatus = toAppStatus(state, error)
  const usingPreview = state === 'stopped' && !error && previewStatus !== null
  const status = usingPreview ? previewStatus : liveStatus

  const controlRefs = useRef<Record<ControlId, HTMLElement | null>>({
    'target-language': null,
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

  const isListening = isActive
  const liveLines = toTranscriptLines(transcript, targetLanguage)
  const lines = usingPreview ? mockTranscripts : liveLines

  const selectTargetLanguage = useCallback(
    (nextLanguage: SupportedLanguageCode) => {
      void setTargetLanguage(nextLanguage)
    },
    [setTargetLanguage],
  )

  const { handleDemoSelectKeyDown } = useControlKeyboard({
    isListening,
    controlRefs,
    demoDetailsRef,
  })

  function startInterpreter() {
    setPreviewStatus(null)
    void start(targetLanguage)
  }

  function stopInterpreter() {
    setPreviewStatus(null)
    void stop()
  }

  return (
    <div className="app-shell">
      <TopBar status={status} targetLanguage={targetLanguage} />

      <main className="app-main">
        <StatusNotice status={status} detail={error?.message} />
        <Transcript
          status={status}
          lines={lines}
          targetLanguage={targetLanguage}
          interimText={interimTranscript?.text}
          isPlaying={state === 'translating'}
        />
      </main>

      <ControlDock
        targetLanguage={targetLanguage}
        status={status}
        isListening={isListening}
        registerControl={registerControl}
        demoDetailsRef={demoDetailsRef}
        onSelectTargetLanguage={selectTargetLanguage}
        onStart={startInterpreter}
        onStop={stopInterpreter}
        onStatusChange={setPreviewStatus}
        onDemoSelectKeyDown={handleDemoSelectKeyDown}
      />
    </div>
  )
}

export default App
