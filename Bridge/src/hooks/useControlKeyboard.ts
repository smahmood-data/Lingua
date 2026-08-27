import { useCallback, useEffect, useRef } from 'react'
import {
  controlIds,
  controlLayout,
  directions,
  isControlDisabled,
  type ControlId,
  type Direction,
} from '../types'

type Args = {
  direction: Direction
  isListening: boolean
  onSelectDirection: (direction: Direction) => void
  // Refs point to real DOM controls so keyboard navigation can move focus.
  controlRefs: React.RefObject<Record<ControlId, HTMLElement | null>>
  demoDetailsRef: React.RefObject<HTMLDetailsElement | null>
}

// Arrow-key navigation across the direction, microphone, and demo controls.
// The grid model mirrors the visual control layout: directions on one row,
// microphone actions on the next, and the demo state menu below.
export function useControlKeyboard({
  direction,
  isListening,
  onSelectDirection,
  controlRefs,
  demoDetailsRef,
}: Args) {
  // Refs hold a value for the keyboard listener without needing to recreate it
  // every time the direction changes.
  const directionRef = useRef<Direction>(direction)

  // When returning from the demo menu, remember whether Start or Stop came first.
  const lastMicControlRef = useRef<'start' | 'stop'>('start')

  useEffect(() => {
    // Keep the ref and React state synchronized.
    directionRef.current = direction
  }, [direction])

  const focusControl = useCallback(
    (controlId: ControlId) => {
      // The demo select is inside a collapsible details element. Open it before
      // moving focus so keyboard navigation never focuses hidden content.
      if (controlId === 'demo') {
        const demoDetails = demoDetailsRef.current
        if (demoDetails) demoDetails.open = true
      }

      // Moving to a direction also selects it, which updates the transcript.
      if (controlId === 'en-ur' || controlId === 'ur-en') {
        directionRef.current = controlId
        onSelectDirection(controlId)
      }

      if (controlId === 'start' || controlId === 'stop') {
        lastMicControlRef.current = controlId
      }

      controlRefs.current[controlId]?.focus()
    },
    [controlRefs, demoDetailsRef, onSelectDirection],
  )

  useEffect(() => {
    // Find which of our controls currently owns keyboard focus.
    function getFocusedControl(): ControlId | null {
      const focusedElement = document.activeElement

      return (
        controlIds.find(
          (controlId) => controlRefs.current[controlId] === focusedElement,
        ) ?? null
      )
    }

    function getNextControl(
      focusedControl: ControlId,
      key: string,
    ): ControlId | null {
      // The demo menu sits below both microphone controls.
      if (
        (focusedControl === 'start' || focusedControl === 'stop') &&
        key === 'ArrowDown'
      ) {
        lastMicControlRef.current = focusedControl
        return 'demo'
      }

      const rowIndex = controlLayout.findIndex((row) =>
        row.includes(focusedControl),
      )
      const row = controlLayout[rowIndex]
      const columnIndex = row.indexOf(focusedControl)

      if (key === 'Home') {
        return (
          row.find((controlId) => !isControlDisabled(controlId, isListening)) ??
          null
        )
      }

      if (key === 'End') {
        const enabledControls = row.filter(
          (controlId) => !isControlDisabled(controlId, isListening),
        )
        return enabledControls[enabledControls.length - 1] ?? null
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const nextColumn = columnIndex + (key === 'ArrowRight' ? 1 : -1)

        if (nextColumn < 0 || nextColumn >= row.length) return null

        const nextControl = row[nextColumn]
        return isControlDisabled(nextControl, isListening)
          ? null
          : nextControl
      }

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const nextRowIndex = rowIndex + (key === 'ArrowDown' ? 1 : -1)

        if (nextRowIndex < 0 || nextRowIndex >= controlLayout.length) {
          return null
        }

        const targetRow = controlLayout[nextRowIndex]
        const nextControl = targetRow[columnIndex]

        // If the same-column control is disabled, move to another enabled
        // control in the target row instead of leaving focus stranded.
        return (
          (nextControl && !isControlDisabled(nextControl, isListening)
            ? nextControl
            : targetRow.find(
                (controlId) => !isControlDisabled(controlId, isListening),
              )) ?? null
        )
      }

      return null
    }

    // This listener provides arrow-key navigation even if the mouse is elsewhere.
    function handleControlShortcut(event: globalThis.KeyboardEvent) {
      // Do not take over arrow keys inside form fields such as the state select.
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
          event.key,
        )
      ) {
        return
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }

      const focusedControl = getFocusedControl()
      let nextControl: ControlId | null = null

      if (focusedControl) {
        nextControl = getNextControl(focusedControl, event.key)
      } else if (event.key === 'ArrowDown') {
        const directionColumn = directions.indexOf(directionRef.current)
        const microphoneRow = controlLayout[1]
        const controlBelow = microphoneRow[directionColumn]
        nextControl =
          (controlBelow && !isControlDisabled(controlBelow, isListening)
            ? controlBelow
            : microphoneRow.find(
                (controlId) => !isControlDisabled(controlId, isListening),
              )) ?? null
      } else if (event.key === 'ArrowUp') {
        nextControl = directionRef.current
      } else {
        const currentIndex = directions.indexOf(directionRef.current)
        let nextIndex: number

        if (event.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % directions.length
        } else if (event.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + directions.length) % directions.length
        } else if (event.key === 'Home') {
          nextIndex = 0
        } else if (event.key === 'End') {
          nextIndex = directions.length - 1
        } else {
          return
        }

        nextControl = directions[nextIndex]
      }

      if (!nextControl || isControlDisabled(nextControl, isListening)) return

      event.preventDefault()

      // Focus the next control; focusControl also updates direction when needed.
      focusControl(nextControl)
    }

    window.addEventListener('keydown', handleControlShortcut)
    // Remove the listener when the component is cleaned up or listening changes.
    return () => window.removeEventListener('keydown', handleControlShortcut)
  }, [isListening, controlRefs, focusControl])

  // Arrow keys inside the native select would otherwise change the option
  // or be captured by the grid handler, so the select handles them itself.
  function handleDemoSelectKeyDown(event: React.KeyboardEvent<HTMLSelectElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
    }

    if (
      event.key === 'ArrowUp' &&
      event.currentTarget.selectedIndex === 0
    ) {
      event.preventDefault()
      if (demoDetailsRef.current) {
        demoDetailsRef.current.open = false
      }

      const previousControl = isControlDisabled(
        lastMicControlRef.current,
        isListening,
      )
        ? isListening
          ? 'stop'
          : 'start'
        : lastMicControlRef.current

      focusControl(previousControl)
    }
  }

  return { focusControl, handleDemoSelectKeyDown }
}
