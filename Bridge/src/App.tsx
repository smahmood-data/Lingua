import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Conversation } from './components/Conversation'
import { IdleHome } from './components/IdleHome'
import { MicButton, type MicPhase } from './components/MicButton'
import { SessionBar } from './components/SessionBar'
import { StatusNotice } from './components/StatusNotice'
import { TopBar } from './components/TopBar'
import { useControlKeyboard } from './hooks/useControlKeyboard'
import { useTranslationSession } from './hooks/useTranslationSession'
import type { ConversationTurn, SessionState } from './lib/translation'
import {
  AUTO_SOURCE_LANGUAGE,
  languageCodesMatch,
  languageMetaFromCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from './types'
import { languageColor } from './languageDisplay'
import './App.css'

type AppMode = 'idle' | 'session' | 'ended'

function toMicPhase(state: SessionState, error: boolean): MicPhase {
  if (error) return 'error'
  if (state === 'connecting') return 'connecting'
  if (state === 'listening') return 'listening'
  if (state === 'translating') return 'translating'
  if (state === 'playing') return 'playing'
  if (state === 'stopped') return 'ended'
  return 'idle'
}

function micLabel(phase: MicPhase): string {
  switch (phase) {
    case 'idle':
      return 'Start conversation'
    case 'connecting':
      return 'Connecting'
    case 'listening':
      return 'Stop conversation'
    case 'translating':
      return 'Stop conversation'
    case 'playing':
      return 'Stop conversation'
    case 'ended':
      return 'Start new conversation'
    case 'error':
      return 'Start new conversation'
  }
}

/** The left side of the canvas: explicit source, or Auto's detected counterpart. */
function leftLanguage(
  sourceLanguage: SourceLanguageCode,
  counterpartLanguage: SupportedLanguageCode | null,
): SupportedLanguageCode | null {
  return sourceLanguage === AUTO_SOURCE_LANGUAGE
    ? counterpartLanguage
    : sourceLanguage
}

export default function App() {
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
    clearTranscript,
  } = useTranslationSession()

  const [mode, setMode] = useState<AppMode>('idle')
  const [retainedTurns, setRetainedTurns] = useState<ConversationTurn[]>([])
  const [micBusy, setMicBusy] = useState(false)

  const shellRef = useRef<HTMLDivElement>(null)
  const heroSlotRef = useRef<HTMLDivElement>(null)
  const dockSlotRef = useRef<HTMLDivElement>(null)
  const micRef = useRef<HTMLButtonElement>(null)
  const sourceSelectRef = useRef<HTMLButtonElement>(null)
  const targetSelectRef = useRef<HTMLButtonElement>(null)
  const swapRef = useRef<HTMLButtonElement>(null)
  const newSessionRef = useRef<HTMLButtonElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)
  const controlRefs = useRef<Record<string, HTMLElement | null>>({})

  // Keep keyboard-navigation refs in sync with the rendered controls.
  useEffect(() => {
    controlRefs.current['source-language'] = sourceSelectRef.current
    controlRefs.current['target-language'] = targetSelectRef.current
    controlRefs.current['swap'] = swapRef.current
    controlRefs.current['mic'] = micRef.current
    controlRefs.current['new-session'] = newSessionRef.current
    controlRefs.current['clear'] = clearRef.current
  })

  // Enter session mode the moment a start is requested; return to idle only
  // when the transcript has been cleared.
  useEffect(() => {
    if (isActive) {
      setMode('session')
      return
    }
    if (state === 'stopped' && (turns.length > 0 || retainedTurns.length > 0)) {
      setMode('ended')
      return
    }
    if (state === 'error') {
      setMode(turns.length > 0 || retainedTurns.length > 0 ? 'ended' : 'idle')
      return
    }
    if (turns.length === 0 && retainedTurns.length === 0) {
      setMode('idle')
    }
  }, [isActive, state, turns.length, retainedTurns.length])

  // Keep a copy of the transcript when the session ends so it stays on screen.
  useEffect(() => {
    if (!isActive && turns.length > 0) {
      setRetainedTurns(turns)
    }
  }, [isActive, turns])

  const displayTurns = isActive || turns.length > 0 ? turns : retainedTurns
  const showConversation = mode !== 'idle' && displayTurns.length > 0
  const micPhase = toMicPhase(state, Boolean(error))
  const leftCode = leftLanguage(sourceLanguage, counterpartLanguage)

  const playingLanguage =
    state === 'playing'
      ? languageMetaFromCode(
          displayTurns.at(-1)?.targetLanguage ?? targetLanguage,
        ).label
      : null
  const playingColor =
    state === 'playing'
      ? languageColor(
          displayTurns.at(-1)?.targetLanguage ?? targetLanguage,
        )
      : null

  const controlIds = useMemo(() => {
    if (mode === 'idle') {
      return ['source-language', 'swap', 'target-language', 'mic']
    }
    if (mode === 'ended' || state === 'error') {
      return ['mic', 'new-session', 'clear']
    }
    return ['mic']
  }, [mode, state])

  useControlKeyboard({ controls: controlIds, controlRefs })

  // One mic button travels between the hero slot and the dock slot.
  useLayoutEffect(() => {
    const mic = micRef.current
    const shell = shellRef.current
    const slot =
      mode === 'idle' ? heroSlotRef.current : dockSlotRef.current
    if (!mic || !shell || !slot) return

    const shellRect = shell.getBoundingClientRect()
    const slotRect = slot.getBoundingClientRect()
    const size = mode === 'idle' ? 104 : 56

    mic.style.width = `${size}px`
    mic.style.height = `${size}px`
    mic.style.transform = `translate(${slotRect.left - shellRect.left}px, ${slotRect.top - shellRect.top}px)`
  }, [mode, state, showConversation, displayTurns.length])

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

  const swapLanguages = useCallback(() => {
    if (sourceLanguage === AUTO_SOURCE_LANGUAGE) return
    void setLanguages(targetLanguage, sourceLanguage)
  }, [setLanguages, sourceLanguage, targetLanguage])

  async function handleMicClick() {
    if (micBusy) return
    setMicBusy(true)
    try {
      if (isActive) {
        await stop()
        return
      }
      setRetainedTurns([])
      await start(sourceLanguage, targetLanguage)
    } finally {
      setMicBusy(false)
    }
  }

  async function handleNewSession() {
    if (micBusy) return
    setMicBusy(true)
    try {
      setRetainedTurns([])
      await start(sourceLanguage, targetLanguage)
    } finally {
      setMicBusy(false)
    }
  }

  function handleClear() {
    clearTranscript()
    setRetainedTurns([])
    setMode('idle')
  }

  return (
    <div
      className={`app-shell mode-${mode}${showConversation ? ' has-conversation' : ''}`}
      ref={shellRef}
    >
      <TopBar
        session={mode !== 'idle'}
        leftCode={leftCode}
        rightCode={targetLanguage}
      />

      <main className="app-main">
        {error ? <StatusNotice error={error} /> : null}

        {showConversation ? (
          <Conversation
            turns={displayTurns}
            interimTranscript={isActive ? interimTranscript : null}
            leftCode={leftCode}
            rightCode={targetLanguage}
          />
        ) : mode === 'idle' ? (
          <IdleHome
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            heroSlotRef={heroSlotRef}
            onSelectSourceLanguage={selectSourceLanguage}
            onSelectTargetLanguage={selectTargetLanguage}
            onSwapLanguages={swapLanguages}
            sourceSelectRef={sourceSelectRef}
            targetSelectRef={targetSelectRef}
            swapRef={swapRef}
          />
        ) : null}
      </main>

      {mode !== 'idle' ? (
        <SessionBar
          phase={micPhase === 'idle' ? 'ended' : micPhase}
          playingLanguage={playingLanguage}
          playingColor={playingColor}
          dockSlotRef={dockSlotRef}
          onNewSession={handleNewSession}
          onClear={handleClear}
          newSessionRef={newSessionRef}
          clearRef={clearRef}
        />
      ) : null}

      <MicButton
        phase={mode === 'idle' ? 'idle' : micPhase}
        accentColor={playingColor}
        disabled={micBusy}
        label={micLabel(mode === 'idle' ? 'idle' : micPhase)}
        buttonRef={micRef}
        onClick={handleMicClick}
      />
    </div>
  )
}
