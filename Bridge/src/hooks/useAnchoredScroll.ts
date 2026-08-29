import { useCallback, useEffect, useRef, useState } from 'react'

const ANCHOR_THRESHOLD_PX = 96

/**
 * Keeps a scrolling conversation pinned to the newest content — but only while
 * the reader is already near the bottom. Someone who scrolled up to reread is
 * left alone and offered a quiet way back instead of being yanked downward.
 */
export function useAnchoredScroll(
  scrollRef: React.RefObject<HTMLElement | null>,
  /** Changes whenever the content at the tail of the list changes. */
  tailKey: string,
) {
  const anchoredRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight
    anchoredRef.current = distance < ANCHOR_THRESHOLD_PX
    if (anchoredRef.current) setShowJump(false)
  }, [scrollRef])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (anchoredRef.current) {
      element.scrollTop = element.scrollHeight
    } else {
      setShowJump(true)
    }
    // Only the tail matters: a new turn, or the live turn growing.
  }, [scrollRef, tailKey])

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    element.scrollTo({
      top: element.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
    anchoredRef.current = true
    setShowJump(false)
  }, [scrollRef])

  return { handleScroll, showJump, jumpToLatest }
}
