import { useCallback, useEffect, useRef } from 'react'
import {
  controlIds,
  controlLayout,
  isControlDisabled,
  partnerLanguages,
  type ControlId,
  type PartnerLanguage,
} from '../types'

type Args = {
  partnerLanguage: PartnerLanguage
  isListening: boolean
  onSelectPartner: (language: PartnerLanguage) => void
  // Refs point to real DOM controls so keyboard navigation can move focus.
  controlRefs: React.RefObject<Record<ControlId, HTMLElement | null>>
  demoDetailsRef: React.RefObject<HTMLDetailsElement | null>
}

// Arrow-key navigation across the language, microphone, and demo controls.
// The grid model mirrors the visual control layout: languages on one row,
// microphone actions on the next, and the demo state menu below.
export function useControlKeyboard({
  partnerLanguage,
  isListening,
  onSelectPartner,
  controlRefs,
  demoDetailsRef,
}: Args) {
  const partnerRef = useRef<PartnerLanguage>(partnerLanguage)

  // When returning from the demo menu, remember whether Start or Stop came first.
  const lastMicControlRef = useRef<'start' | 'stop'>('start')

  useEffect(() => {
    partnerRef.current = partnerLanguage
  }, [partnerLanguage])

  const focusControl = useCallback(
    (controlId: ControlId) => {
      // The demo select is inside a collapsible details element. Open it before
      // moving focus so keyboard navigation never focuses hidden content.
      if (controlId === 'demo') {
        const demoDetails = demoDetailsRef.current
        if (demoDetails) demoDetails.open = true
      }

      if (controlId === 'ur' || controlId === 'es' || controlId === 'bn') {
        partnerRef.current = controlId
        onSelectPartner(controlId)
      }

      if (controlId === 'start' || controlId === 'stop') {
        lastMicControlRef.current = controlId
      }

      controlRefs.current[controlId]?.focus()
    },
    [controlRefs, demoDetailsRef, onSelectPartner],
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
        const nextControl = targetRow[Math.min(columnIndex, targetRow.length - 1)]

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

    function handleControlShortcut(event: globalThis.KeyboardEvent) {
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
        const languageColumn = partnerLanguages.indexOf(partnerRef.current)
        const microphoneRow = controlLayout[1]
        const controlBelow = microphoneRow[Math.min(languageColumn, microphoneRow.length - 1)]
        nextControl =
          (controlBelow && !isControlDisabled(controlBelow, isListening)
            ? controlBelow
            : microphoneRow.find(
                (controlId) => !isControlDisabled(controlId, isListening),
              )) ?? null
      } else if (event.key === 'ArrowUp') {
        nextControl = partnerRef.current
      } else {
        const currentIndex = partnerLanguages.indexOf(partnerRef.current)
        let nextIndex: number

        if (event.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % partnerLanguages.length
        } else if (event.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + partnerLanguages.length) % partnerLanguages.length
        } else if (event.key === 'Home') {
          nextIndex = 0
        } else if (event.key === 'End') {
          nextIndex = partnerLanguages.length - 1
        } else {
          return
        }

        nextControl = partnerLanguages[nextIndex]
      }

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
