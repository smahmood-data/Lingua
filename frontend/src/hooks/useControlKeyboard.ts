import { useEffect } from 'react'

type Args = {
  /** Focusable controls in spatial order; arrow keys walk this list. */
  controls: string[]
  controlRefs: React.RefObject<Record<string, HTMLElement | null>>
}

/**
 * Arrow-key navigation across the controls currently on screen (language
 * pickers, swap, microphone, session actions).
 *
 * The hook only ever *moves between* controls: it activates when focus is
 * already on one of them, so arrow keys elsewhere keep their native behavior
 * (scrolling the conversation, editing text). Open language menus handle
 * their own keys and stop propagation, so the two never fight.
 */
export function useControlKeyboard({ controls, controlRefs }: Args) {
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
          event.key,
        ) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }

      const enabled = controls.filter((id) => {
        const element = controlRefs.current[id]
        return (
          element && !(element as HTMLButtonElement).disabled
        )
      })
      const currentIndex = enabled.findIndex(
        (id) => controlRefs.current[id] === document.activeElement,
      )
      if (currentIndex < 0) return

      let nextIndex: number
      if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = enabled.length - 1
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = currentIndex + 1
      } else {
        nextIndex = currentIndex - 1
      }
      if (nextIndex < 0 || nextIndex >= enabled.length) return

      event.preventDefault()
      controlRefs.current[enabled[nextIndex]]?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [controls, controlRefs])
}
