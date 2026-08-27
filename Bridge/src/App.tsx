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
  languageFromCode,
  partnerLanguageMeta,
  type AppStatus,
  type ControlId,
  type Language,
  type PartnerLanguage,
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

function otherLanguage(language: Language, partner: PartnerLanguage): Language {
  return language === 'English' ? partnerLanguageMeta[partner].label : 'English'
}

function toTranscriptLines(
  turns: TranscriptTurn[],
  partner: PartnerLanguage,
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

    const originalLanguage = languageFromCode(
      source?.languageCode ?? spoken.languageCode,
    )
    const translatedLanguage = translation
      ? languageFromCode(translation.languageCode)
      : otherLanguage(originalLanguage, partner)

    lines.push({
      id,
      speaker: originalLanguage === 'English' ? 'You' : 'Speaker',
      originalLanguage,
      translatedLanguage,
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
    startConversation,
    stop,
  } = useTranslationSession()

  const [partnerLanguage, setPartnerLanguage] = useState<PartnerLanguage>('ur')
  const [previewStatus, setPreviewStatus] = useState<AppStatus | null>(null)
  const liveStatus = toAppStatus(state, error)
  const usingPreview = state === 'stopped' && !error && previewStatus !== null
  const status = usingPreview ? previewStatus : liveStatus

  const controlRefs = useRef<Record<ControlId, HTMLElement | null>>({
    ur: null,
    es: null,
    bn: null,
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
  const sourceLanguage = partnerLanguageMeta[partnerLanguage].label
  const liveLines = toTranscriptLines(transcript, partnerLanguage)
  const lines = usingPreview ? mockTranscripts[partnerLanguage] : liveLines

  const selectPartner = useCallback(
    (nextLanguage: PartnerLanguage) => {
      setPartnerLanguage(nextLanguage)
      if (isActive) {
        void stop()
      }
    },
    [isActive, stop],
  )

  const { handleDemoSelectKeyDown } = useControlKeyboard({
    partnerLanguage,
    isListening,
    onSelectPartner: selectPartner,
    controlRefs,
    demoDetailsRef,
  })

  function startInterpreter() {
    setPreviewStatus(null)
    void startConversation(partnerLanguage)
  }

  function stopInterpreter() {
    setPreviewStatus(null)
    void stop()
  }

  return (
    <div className="app-shell">
      <TopBar status={status} partnerLanguage={partnerLanguage} />

      <main className="app-main">
        <StatusNotice status={status} detail={error?.message} />
        <Transcript
          status={status}
          lines={lines}
          sourceLanguage={sourceLanguage}
          partnerLanguage={partnerLanguage}
          interimText={interimTranscript?.text}
          isPlaying={state === 'translating'}
        />
      </main>

      <ControlDock
        partnerLanguage={partnerLanguage}
        status={status}
        isListening={isListening}
        registerControl={registerControl}
        demoDetailsRef={demoDetailsRef}
        onSelectPartner={selectPartner}
        onStart={startInterpreter}
        onStop={stopInterpreter}
        onStatusChange={setPreviewStatus}
        onDemoSelectKeyDown={handleDemoSelectKeyDown}
      />
    </div>
  )
}

export default App
