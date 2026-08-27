import { useCallback, useEffect, useRef, useState } from 'react'
import { appendTurn, createTurn, hasSpokenContent } from './transcript.ts'
import { requestSummary } from './summaryClient.ts'
import {
  isSummaryEmpty,
  type ConversationSummary,
  type Speaker,
  type SummaryErrorCode,
  type TranscriptTurn,
} from './types.ts'

/**
 * Every state the summary screen can be in. It is a discriminated union so a
 * renderer cannot read `summary` before it exists, and so the empty and
 * failed cases are states in their own right rather than a null check.
 */
export type SummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: ConversationSummary }
  /** The conversation had no speech, so nothing was ever sent to Gemini. */
  | { status: 'empty' }
  /**
   * Gemini answered but extracted no actionable items. The summary is still
   * carried so the screen can show the prose instead of seven empty headings.
   */
  | { status: 'nothing-found'; summary: ConversationSummary }
  | { status: 'error'; code: SummaryErrorCode }

export type ConversationSummaryController = {
  turns: readonly TranscriptTurn[]
  state: SummaryState
  /** False when there is nothing to summarise; drives the disabled button. */
  canSummarize: boolean
  recordTurn: (turn: { speaker: Speaker; original: string; translated?: string }) => void
  /** Ends the conversation and asks for a summary. Safe to call when empty. */
  endConversation: () => void
  reset: () => void
}

export function useConversationSummary(readingLanguage: string): ConversationSummaryController {
  // Session-scoped only. Nothing here is persisted, so a refresh discards
  // the conversation by construction.
  const [turns, setTurns] = useState<readonly TranscriptTurn[]>([])
  const [state, setState] = useState<SummaryState>({ status: 'idle' })

  /**
   * The transcript is kept in a ref as well as in state because the two are
   * read at different moments. State drives what is rendered; the ref is what
   * `endConversation` sends. Reading state there would send whatever was
   * current at the last commit, so a turn finalised in the same tick as the
   * end of the conversation — exactly what happens when the stop control
   * flushes the final turn before asking for a summary — would be dropped,
   * and a whole burst of turns would look like an empty conversation.
   */
  const turnsRef = useRef<readonly TranscriptTurn[]>([])

  const inFlight = useRef<AbortController | null>(null)

  // Abandon a request that is still running when the screen goes away, so a
  // late response cannot set state on an unmounted component.
  useEffect(() => {
    return () => inFlight.current?.abort()
  }, [])

  const recordTurn = useCallback<ConversationSummaryController['recordTurn']>((turn) => {
    const next = appendTurn(turnsRef.current, createTurn(turn))
    turnsRef.current = next
    setTurns(next)
  }, [])

  const reset = useCallback(() => {
    inFlight.current?.abort()
    inFlight.current = null
    turnsRef.current = []
    setTurns([])
    setState({ status: 'idle' })
  }, [])

  const endConversation = useCallback(() => {
    const currentTurns = turnsRef.current

    if (!hasSpokenContent(currentTurns)) {
      setState({ status: 'empty' })
      return
    }

    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ status: 'loading' })

    void (async () => {
      try {
        const result = await requestSummary(
          { readingLanguage, turns: currentTurns },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        if (!result.ok) {
          setState(
            result.code === 'empty_transcript'
              ? { status: 'empty' }
              : { status: 'error', code: result.code },
          )
          return
        }

        setState(
          isSummaryEmpty(result.summary)
            ? { status: 'nothing-found', summary: result.summary }
            : { status: 'ready', summary: result.summary },
        )
      } catch {
        // Only an abort reaches here; requestSummary maps real failures.
        if (!controller.signal.aborted) setState({ status: 'error', code: 'network_error' })
      } finally {
        if (inFlight.current === controller) inFlight.current = null
      }
    })()
  }, [readingLanguage])

  return {
    turns,
    state,
    canSummarize: hasSpokenContent(turns),
    recordTurn,
    endConversation,
    reset,
  }
}
