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
import {
  IdleSessionEndedNotice,
  IdleSessionNotice,
  StatusNotice,
} from './components/StatusNotice'
import { TopBar } from './components/TopBar'
import { useControlKeyboard } from './hooks/useControlKeyboard'
import { useTheme } from './hooks/useTheme'
import { useTranslationSession } from './hooks/useTranslationSession'
import type { SessionState } from './lib/translation'
import {
  AUTO_SOURCE_LANGUAGE,
  languageCodesMatch,
  languageMetaFromCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from './types'
import { languageColor } from './languageDisplay'
import './App.css'

/** Which composition the canvas is in. */
type AppMode = 'idle' | 'session' | 'ended'

/** A start or stop the session has accepted but not finished. */
type Transition = 'start' | 'stop' | null

function micLabel(phase: MicPhase): string {
  switch (phase) {
    case 'idle':
      return 'Start conversation'
    case 'connecting':
      return 'Connecting'
    case 'ending':
      return 'Ending conversation'
    case 'listening':
    case 'translating':
    case 'playing':
      return 'End conversation'
    case 'ended':
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

/**
 * What the microphone is showing, derived from the session and from a start or
 * stop the session has accepted but not yet announced. There is no second
 * lifecycle here: `transition` only covers the window in which the session is
 * still opening sockets or tearing them down.
 */
function toMicPhase(
  state: SessionState,
  hasError: boolean,
  transition: Transition,
  mode: AppMode,
): MicPhase {
  if (transition === 'stop') return 'ending'
  if (hasError) return 'error'
  if (transition === 'start' && state === 'stopped') return 'connecting'
  switch (state) {
    case 'connecting':
      return 'connecting'
    case 'listening':
      return 'listening'
    case 'translating':
      return 'translating'
    case 'playing':
      return 'playing'
    default:
      return mode === 'idle' ? 'idle' : 'ended'
  }
}

export default function App() {
  const {
    state,
    error,
    turns,
    interimTranscript,
    idleTimeoutEndedAt,
    idleWarningEndsAt,
    isActive,
    sourceLanguage,
    targetLanguage,
    counterpartLanguage,
    start,
    setLanguages,
    stop,
    clearTranscript,
  } = useTranslationSession()

  const { theme, toggleTheme } = useTheme()

  // The session keeps its committed history across a stop, so the conversation
  // stays on screen by itself: nothing here needs to copy or retain it.
  const [transition, setTransition] = useState<Transition>(null)

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

  const live = isActive || transition !== null
  const mode: AppMode = live ? 'session' : turns.length > 0 ? 'ended' : 'idle'
  const micPhase = toMicPhase(state, Boolean(error), transition, mode)
  const leftCode = leftLanguage(sourceLanguage, counterpartLanguage)

  // While Lingua speaks, the turn being spoken owns the mic and waveform colour.
  const playbackTarget =
    state === 'playing' ? (turns.at(-1)?.targetLanguage ?? targetLanguage) : null
  const playingLanguage = playbackTarget
    ? languageMetaFromCode(playbackTarget).label
    : null
  const playingColor = playbackTarget ? languageColor(playbackTarget) : null

  const controlIds = useMemo(() => {
    if (mode === 'idle') {
      return ['source-language', 'swap', 'target-language', 'mic']
    }
    if (mode === 'ended') return ['mic', 'new-session', 'clear']
    return ['mic']
  }, [mode])

  useControlKeyboard({ controls: controlIds, controlRefs })

  /*
    One microphone, two homes. The shell measures whichever slot the current
    composition offers and moves the button there; CSS animates the journey.
    The first placement is deliberately not animated — see `data-placed`.
  */
  useLayoutEffect(() => {
    const mic = micRef.current
    const shell = shellRef.current
    if (!mic || !shell) return

    // The font callback below can outlive this effect; a stale one would
    // place the mic in the composition we have already left.
    let cancelled = false
    const place = () => {
      if (cancelled) return
      const slot = mode === 'idle' ? heroSlotRef.current : dockSlotRef.current
      if (!slot) return
      const shellRect = shell.getBoundingClientRect()
      const slotRect = slot.getBoundingClientRect()

      // The slot's own size decides the mic's, so a CSS breakpoint that
      // resizes a slot resizes the microphone with it.
      mic.style.width = `${slotRect.width}px`
      mic.style.height = `${slotRect.height}px`
      mic.style.translate = `${slotRect.left - shellRect.left}px ${
        slotRect.top - shellRect.top
      }px`
    }

    place()

    /*
      The slot can still move after this first pass — loading the interface
      font reflows the copy above it — and a ResizeObserver reports size, not
      position, so it would never notice. Re-place on the next frame and again
      once the fonts have settled, and only then allow the mic to animate:
      until it has found its slot, every correction should be invisible.
    */
    const frame = requestAnimationFrame(() => {
      place()
      if (!mic.dataset.placed) {
        void mic.offsetWidth
        mic.dataset.placed = 'true'
      }
    })
    void document.fonts?.ready.then(place)

    const observer = new ResizeObserver(place)
    observer.observe(shell)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [mode, micPhase])

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

  /*
    Start and stop are asynchronous, and the session serializes them against
    each other. A tap arriving while one is still in flight is dropped here
    rather than queued: `transitionRef` is set synchronously, so two taps in
    the same tick cannot both get through, and it is cleared only when the
    session's own promise settles — never on a timer.
  */
  const transitionRef = useRef<Transition>(null)
  const runTransition = useCallback(
    async (kind: Exclude<Transition, null>, action: () => Promise<void>) => {
      if (transitionRef.current !== null) return
      transitionRef.current = kind
      setTransition(kind)
      try {
        await action()
      } finally {
        transitionRef.current = null
        setTransition(null)
      }
    },
    [],
  )

  const handleMicClick = useCallback(() => {
    void runTransition(isActive ? 'stop' : 'start', () =>
      isActive ? stop() : start(sourceLanguage, targetLanguage),
    )
  }, [isActive, runTransition, sourceLanguage, start, stop, targetLanguage])

  const handleNewSession = useCallback(() => {
    void runTransition('start', () => start(sourceLanguage, targetLanguage))
  }, [runTransition, sourceLanguage, start, targetLanguage])

  const showConversation = mode !== 'idle' && turns.length > 0

  return (
    <div className={`app-shell mode-${mode}`} ref={shellRef}>
      <TopBar
        session={mode !== 'idle'}
        leftCode={leftCode}
        rightCode={targetLanguage}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {error ? (
        <StatusNotice
          key={`${error.code}:${error.message}:${error.retryAfterSeconds ?? ''}`}
          error={error}
        />
      ) : idleWarningEndsAt !== null ? (
        <IdleSessionNotice
          key={idleWarningEndsAt}
          endsAt={idleWarningEndsAt}
        />
      ) : idleTimeoutEndedAt !== null ? (
        <IdleSessionEndedNotice key={idleTimeoutEndedAt} />
      ) : null}

      <main className="app-main">
        {showConversation ? (
          <Conversation
            turns={turns}
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
          busy={transition !== null}
          onNewSession={handleNewSession}
          onClear={clearTranscript}
          newSessionRef={newSessionRef}
          clearRef={clearRef}
        />
      ) : null}

      <MicButton
        phase={micPhase}
        accentColor={playingColor}
        disabled={transition !== null}
        label={micLabel(micPhase)}
        buttonRef={micRef}
        onClick={handleMicClick}
      />
    </div>
  )
}
