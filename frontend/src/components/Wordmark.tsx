import { useEffect, useRef, useState } from 'react'
import {
  splitGraphemes,
  WORDMARK_STAGES,
  WORDMARK_TIMING,
} from './wordmarkAnimation'
import './TopBar.css'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  )
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [])

  return reducedMotion
}

type AnimatedFrame = {
  text: string
  lang: (typeof WORDMARK_STAGES)[number]['lang']
}

function LinguaLogo({
  reveal = false,
  onRevealEnd,
}: {
  reveal?: boolean
  onRevealEnd?: () => void
}) {
  return (
    <h1
      className={`wordmark${reveal ? ' wordmark-final-reveal' : ''}`}
      onAnimationEnd={reveal ? onRevealEnd : undefined}
    >
      <span className="sr-only">Lingua</span>
      {/* lām — read as the L, set in its own script. */}
      <span className="wordmark-lam" aria-hidden="true" lang="ar">
        ل
      </span>
      <span className="wordmark-stem" aria-hidden="true">
        ingua
      </span>
    </h1>
  )
}

export function Wordmark({ idle }: { idle: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  const initialIdle = useRef(idle)
  const completed = useRef(false)
  const [showFinal, setShowFinal] = useState(
    () => !idle || prefersReducedMotion(),
  )
  const [revealFinal, setRevealFinal] = useState(false)
  const [frame, setFrame] = useState<AnimatedFrame>({
    text: '',
    lang: WORDMARK_STAGES[0].lang,
  })

  useEffect(() => {
    if (!idle) {
      completed.current = true
      // Resolve at the lifecycle boundary so a session never sees a partial word.
      // oxlint-disable-next-line react/set-state-in-effect
      setShowFinal(true)
      return
    }

    if (reducedMotion || !initialIdle.current || completed.current) {
      completed.current = true
      setShowFinal(true)
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let stageIndex = 0
    let graphemes = splitGraphemes(WORDMARK_STAGES[stageIndex].text)
    let cursor = 0

    const schedule = (callback: () => void, delay: number) => {
      timer = setTimeout(callback, delay)
    }

    function startStage() {
      const stage = WORDMARK_STAGES[stageIndex]
      graphemes = splitGraphemes(stage.text)
      cursor = 0
      setFrame({ text: '', lang: stage.lang })
      typeNext()
    }

    function typeNext() {
      const stage = WORDMARK_STAGES[stageIndex]
      if (cursor < graphemes.length) {
        cursor += 1
        setFrame({
          text: graphemes.slice(0, cursor).join(''),
          lang: stage.lang,
        })
        schedule(typeNext, WORDMARK_TIMING.typeMs)
        return
      }

      schedule(deleteNext, WORDMARK_TIMING.holdMs)
    }

    function deleteNext() {
      const stage = WORDMARK_STAGES[stageIndex]
      if (cursor > 0) {
        cursor -= 1
        setFrame({
          text: graphemes.slice(0, cursor).join(''),
          lang: stage.lang,
        })
        schedule(deleteNext, WORDMARK_TIMING.deleteMs)
        return
      }

      if (stageIndex < WORDMARK_STAGES.length - 1) {
        stageIndex += 1
        schedule(startStage, WORDMARK_TIMING.transitionMs)
        return
      }

      completed.current = true
      setRevealFinal(true)
      setShowFinal(true)
    }

    startStage()

    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [idle, reducedMotion])

  const finalVisible = showFinal || !idle || reducedMotion

  return finalVisible ? (
    <LinguaLogo
      reveal={revealFinal}
      onRevealEnd={() => setRevealFinal(false)}
    />
  ) : (
    <h1
      className="wordmark wordmark-animated"
      aria-label="Lingua"
      data-word={frame.text}
    >
      <span
        className="wordmark-copy"
        aria-hidden="true"
        dir={frame.lang === 'ar' ? 'rtl' : 'ltr'}
        lang={frame.lang}
      >
        {frame.text}
      </span>
    </h1>
  )
}
