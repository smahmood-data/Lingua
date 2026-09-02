import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { ConversationCoordinator } from './conversation'
import type { SupportedLanguageCode } from './types'

/**
 * Replay a real browser trace through the coordinator.
 *
 * Mocked suites kept passing while the browser produced nonsense, so this exists
 * to put a recorded session back through the real decision-making and assert the
 * product invariants against it. It is skipped unless a trace is supplied,
 * because the traces are captured by hand and are not in the repository.
 *
 *   LINGUA_TRACE=~/lingua-live-trace.json npm test -- traceReplay
 *
 * Optionally set `LINGUA_TRACE_TARGET` (default `en`) and
 * `LINGUA_TRACE_COUNTERPART` (default auto-detect) to match the session's
 * language selection.
 *
 * A trace records event names, ids and lengths rather than text, so the replay
 * substitutes filler of the recorded length. That is enough for the invariants
 * below — which side spoke, which route was heard, whether a row had a human
 * behind it — and not enough to re-check translation quality.
 */

interface TraceEntry {
  t: number
  event: string
  detail?: Record<string, unknown>
}

const tracePath = process.env.LINGUA_TRACE
const available = Boolean(tracePath && existsSync(tracePath))

describe.skipIf(!available)('recorded session replay', () => {
  it('honours the product invariants on the recorded ordering', () => {
    vi.useFakeTimers()
    try {
      const entries = JSON.parse(
        readFileSync(tracePath!, 'utf8'),
      ) as TraceEntry[]

      const target = (process.env.LINGUA_TRACE_TARGET ??
        'en') as SupportedLanguageCode
      const counterpart = (process.env.LINGUA_TRACE_COUNTERPART ??
        null) as SupportedLanguageCode | null

      let played = 0
      const coordinator = new ConversationCoordinator(
        {
          playAudio: () => {
            played += 1
            return true
          },
          endAudio: () => undefined,
          flushAudio: () => undefined,
          changed: () => undefined,
          counterpartDetected: () => undefined,
        },
        { targetLanguage: target, counterpart, autoDetect: counterpart === null },
      )

      const known = new Set<number>()
      const addRoute = (id: number, into: string) => {
        if (known.has(id)) return
        known.add(id)
        coordinator.addRoute(id, into as SupportedLanguageCode)
      }

      let now = 0
      for (const entry of entries) {
        if (entry.t > now) {
          vi.advanceTimersByTime(entry.t - now)
          now = entry.t
        }
        const detail = (entry.detail ?? {}) as Record<string, never>
        const route = detail.route as unknown as number | undefined
        if (route !== undefined && detail.into) {
          addRoute(route, detail.into as unknown as string)
        }
        const filler = (length: unknown) =>
          'x'.repeat(typeof length === 'number' ? length : 0)

        switch (entry.event) {
          case 'speech-start':
            coordinator.speechStarted(route!, detail.utterance as unknown as number)
            break
          case 'speech-end':
            coordinator.speechEnded(route!, detail.utterance as unknown as number)
            break
          case 'source-transcript':
            coordinator.sourceTranscription(
              route!,
              detail.utterance as unknown as number,
              {
                text: filler(detail.length),
                languageCode: detail.language as unknown as string,
              },
              Boolean(detail.finished),
            )
            break
          case 'translation-transcript':
            coordinator.translationTranscription(
              route!,
              detail.generation as unknown as number,
              { text: filler(detail.length) },
            )
            break
          case 'audio':
            coordinator.audio(
              route!,
              detail.generation as unknown as number,
              new Uint8Array([1, 0, 1, 0]),
            )
            break
          case 'generation-complete':
            coordinator.generationComplete(
              route!,
              detail.generation as unknown as number,
            )
            break
          case 'interrupted':
            coordinator.interrupted(route!, detail.generation as unknown as number)
            break
          case 'turn-end':
            coordinator.routeTurnEnd(
              route!,
              detail.utterance as unknown as number,
              detail.generation as unknown as number,
            )
            break
          case 'playback-start':
            coordinator.playbackStarted()
            break
          case 'playback-end':
            coordinator.playbackEnded()
            break
          case 'barge-in-commit':
            coordinator.bargeIn()
            break
        }
      }
      vi.advanceTimersByTime(5_000)

      const committed = coordinator.turns.filter(
        (turn) => turn.status === 'complete',
      )

      // No row may translate a language into itself.
      for (const turn of committed) {
        if (turn.sourceLanguage && turn.targetLanguage) {
          expect(turn.targetLanguage).not.toBe(turn.sourceLanguage)
        }
      }
      // No row exists without a person having said something.
      for (const turn of committed) {
        expect(turn.sourceText.length).toBeGreaterThan(0)
      }
      // The configured pair is the only thing on screen.
      const pair = new Set(
        [target, counterpart].filter(Boolean) as SupportedLanguageCode[],
      )
      if (counterpart) {
        for (const turn of committed) {
          if (turn.sourceLanguage) expect(pair.has(turn.sourceLanguage as never)).toBe(true)
          if (turn.targetLanguage) expect(pair.has(turn.targetLanguage as never)).toBe(true)
        }
      }
      expect(played).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
