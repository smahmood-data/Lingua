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
  AUTO_SOURCE_LANGUAGE,
  controlIds,
  languageCodesMatch,
  languageMetaFromCode,
  type AppStatus,
  type ControlId,
  type SourceLanguageCode,
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
    sourceLanguage,
    targetLanguage,
    start,
    setLanguages,
    stop,
  } = useTranslationSession()

  const [previewStatus, setPreviewStatus] = useState<AppStatus | null>(null)
  const liveStatus = toAppStatus(state, error)
  const usingPreview = state === 'stopped' && !error && previewStatus !== null
  const status = usingPreview ? previewStatus : liveStatus

  const controlRefs = useRef<Record<ControlId, HTMLElement | null>>({
    'source-language': null,
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

  const selectSourceLanguage = useCallback(
    (nextSource: SourceLanguageCode) => {
      let nextTarget = targetLanguage
      if (
        nextSource !== AUTO_SOURCE_LANGUAGE &&
        languageCodesMatch(nextSource, targetLanguage)
      ) {
        nextTarget =
          sourceLanguage !== AUTO_SOURCE_LANGUAGE &&
          !languageCodesMatch(sourceLanguage, nextSource)
            ? sourceLanguage
            : nextSource === 'en'
              ? 'es'
              : 'en'
      }
      void setLanguages(nextSource, nextTarget)
    },
    [setLanguages, sourceLanguage, targetLanguage],
  )

  const selectTargetLanguage = useCallback(
    (nextLanguage: SupportedLanguageCode) => {
      const nextSource =
        sourceLanguage !== AUTO_SOURCE_LANGUAGE &&
        languageCodesMatch(sourceLanguage, nextLanguage)
          ? targetLanguage
          : sourceLanguage
      void setLanguages(nextSource, nextLanguage)
    },
    [setLanguages, sourceLanguage, targetLanguage],
  )

  const { handleDemoSelectKeyDown } = useControlKeyboard({
    isListening,
    controlRefs,
    demoDetailsRef,
  })

  function startInterpreter() {
    setPreviewStatus(null)
    void start(sourceLanguage, targetLanguage)
  }

  function stopInterpreter() {
    setPreviewStatus(null)
    void stop()
  }

  return (
    <div className="app-shell">
      <TopBar
        status={status}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
      />

      <main className="app-main">
        <StatusNotice status={status} detail={error?.message} />
        <Transcript
          status={status}
          lines={lines}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          interimText={interimTranscript?.text}
          isPlaying={state === 'translating'}
        />
      </main>

      <ControlDock
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        status={status}
        isListening={isListening}
        registerControl={registerControl}
        demoDetailsRef={demoDetailsRef}
        onSelectSourceLanguage={selectSourceLanguage}
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
