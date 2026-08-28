import { useCallback, useEffect, useRef } from 'react'
import {
  controlIds,
  controlLayout,
  isControlDisabled,
  type ControlId,
} from '../types'

type Args = {
  isListening: boolean
  controlRefs: React.RefObject<Record<ControlId, HTMLElement | null>>
  demoDetailsRef: React.RefObject<HTMLDetailsElement | null>
}

// Arrow-key navigation across the language, microphone, and demo controls.
// Native arrow-key behavior is preserved while either select is focused.
export function useControlKeyboard({
  isListening,
  controlRefs,
  demoDetailsRef,
}: Args) {
  const lastMicControlRef = useRef<'start' | 'stop'>('start')

  const focusControl = useCallback(
    (controlId: ControlId) => {
      if (controlId === 'demo') {
        const demoDetails = demoDetailsRef.current
        if (demoDetails) demoDetails.open = true
      }

      if (controlId === 'start' || controlId === 'stop') {
        lastMicControlRef.current = controlId
      }

      controlRefs.current[controlId]?.focus()
    },
    [controlRefs, demoDetailsRef],
  )

  useEffect(() => {
    function getFocusedControl(): ControlId | null {
      const focusedElement = document.activeElement
      return (
        controlIds.find(
          (controlId) => controlRefs.current[controlId] === focusedElement,
        ) ?? null
      )
    }

    function enabledControl(controlId: ControlId | undefined) {
      return controlId && !isControlDisabled(controlId, isListening)
        ? controlId
        : null
    }

    function getNextControl(
      focusedControl: ControlId,
      key: string,
    ): ControlId | null {
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
      if (!row) return null
      const columnIndex = row.indexOf(focusedControl)

      if (key === 'Home') {
        return row.find((id) => !isControlDisabled(id, isListening)) ?? null
      }
      if (key === 'End') {
        return (
          row.findLast((id) => !isControlDisabled(id, isListening)) ?? null
        )
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        return enabledControl(
          row[columnIndex + (key === 'ArrowRight' ? 1 : -1)],
        )
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const targetRow =
          controlLayout[rowIndex + (key === 'ArrowDown' ? 1 : -1)]
        if (!targetRow) return null
        return (
          enabledControl(targetRow[Math.min(columnIndex, targetRow.length - 1)]) ??
          targetRow.find((id) => !isControlDisabled(id, isListening)) ??
          null
        )
      }
      return null
    }

    function handleControlShortcut(event: globalThis.KeyboardEvent) {
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

      const focusedControl = getFocusedControl()
      let nextControl = focusedControl
        ? getNextControl(focusedControl, event.key)
        : event.key === 'ArrowDown'
          ? enabledControl(isListening ? 'stop' : 'start')
          : event.key === 'ArrowUp'
            ? 'target-language'
            : null

      if (!nextControl || isControlDisabled(nextControl, isListening)) return

      event.preventDefault()
      focusControl(nextControl)
    }

    window.addEventListener('keydown', handleControlShortcut)
    return () => window.removeEventListener('keydown', handleControlShortcut)
  }, [isListening, controlRefs, focusControl])

  function handleDemoSelectKeyDown(event: React.KeyboardEvent<HTMLSelectElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
    }

    if (event.key === 'ArrowUp' && event.currentTarget.selectedIndex === 0) {
      event.preventDefault()
      if (demoDetailsRef.current) demoDetailsRef.current.open = false

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
