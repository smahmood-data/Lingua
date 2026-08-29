import { useCallback, useRef, useState } from 'react'
import { ConversationView } from './components/ConversationView'
import { MicConsole } from './components/MicConsole'
import { TopBar } from './components/TopBar'
import { mockTurns } from './data/mockTranscripts'
import { useTranslationSession } from './hooks/useTranslationSession'
import {
  AUTO_ACCENT,
  languageAccent,
  languagePairAccents,
} from './languageAccents'
import {
  AUTO_SOURCE_LANGUAGE,
  languageCodesMatch,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from './types'
import { deriveUiState, type PendingAction, type UiState } from './uiState'
import './App.css'

/**
 * Taps closer together than this are one gesture, not two decisions. The
 * session serializes starts and stops itself; this only keeps a double-tap
 * from asking twice.
 */
const ACTIVATION_DEBOUNCE_MS = 400

function App() {
  const {
    state,
    error,
    turns,
    interimTranscript,
    isActive,
    sourceLanguage,
    targetLanguage,
    counterpartLanguage,
    start,
    setLanguages,
    stop,
  } = useTranslationSession()

  // Developer preview of the visual states, only while no session is live.
  const [previewState, setPreviewState] = useState<UiState | null>(null)
  const usingPreview = state === 'stopped' && !error && previewState !== null

  // A start/stop the session has accepted but not announced yet. This is not a
  // second lifecycle: it only bridges the session's own serialization window
  // and is cleared the moment the observed state settles.
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [observedState, setObservedState] = useState(state)
  if (observedState !== state) {
    setObservedState(state)
    if (
      (pendingAction === 'start' && state !== 'stopped') ||
      (pendingAction === 'stop' && (state === 'stopped' || state === 'error'))
    ) {
      setPendingAction(null)
    }
  }

  const liveState = deriveUiState(state, error, pendingAction)
  const uiState = usingPreview ? previewState : liveState

  const displayedTurns = usingPreview ? mockTurns : turns
  const openTurn = displayedTurns.findLast((turn) => turn.status !== 'complete')
  // Previewing a busy state borrows the last fixture turn's direction.
  const accentTurn =
    openTurn ?? (usingPreview ? displayedTurns[displayedTurns.length - 1] : undefined)

  const isAuto = sourceLanguage === AUTO_SOURCE_LANGUAGE
  const detected = isAuto ? counterpartLanguage : null
  const [accentA, accentB] = (() => {
    const first = isAuto ? detected : sourceLanguage
    return first
      ? languagePairAccents(first, targetLanguage)
      : ([AUTO_ACCENT, languageAccent(targetLanguage)] as const)
  })()

  const lastActivationRef = useRef(0)
  const handleMicActivate = useCallback(() => {
    const now = Date.now()
    if (now - lastActivationRef.current < ACTIVATION_DEBOUNCE_MS) return
    if (pendingAction !== null) return
    if (state === 'connecting') return
    lastActivationRef.current = now
    setPreviewState(null)
    if (isActive) {
      setPendingAction('stop')
      void stop()
    } else {
      setPendingAction('start')
      void start(sourceLanguage, targetLanguage)
    }
  }, [
    pendingAction,
    state,
    isActive,
    start,
    stop,
    sourceLanguage,
    targetLanguage,
  ])

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

  return (
    <div
      className="app-shell"
      style={
        {
          '--lang-a': accentA.strong,
          '--lang-b': accentB.strong,
        } as React.CSSProperties
      }
    >
      <TopBar state={uiState} />

      <main className="app-main">
        <ConversationView
          state={uiState}
          turns={displayedTurns}
          interimTranscript={usingPreview ? null : interimTranscript}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          error={usingPreview ? null : error}
        />
      </main>

      <MicConsole
        state={uiState}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        detectedLanguage={detected}
        pairAccents={[accentA, accentB]}
        liveSource={accentTurn?.sourceLanguage ?? null}
        liveTarget={accentTurn?.targetLanguage ?? null}
        onActivate={handleMicActivate}
        onSelectSourceLanguage={selectSourceLanguage}
        onSelectTargetLanguage={selectTargetLanguage}
        previewState={previewState}
        onPreviewState={setPreviewState}
      />
    </div>
  )
}

export default App
