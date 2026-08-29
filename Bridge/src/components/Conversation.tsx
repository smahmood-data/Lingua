import { useEffect, useRef, type CSSProperties } from 'react'
import type {
  ConversationTurn,
  InterimTranscript,
} from '../lib/translation'
import {
  languageCodesMatch,
  languageMetaFromCode,
  type SupportedLanguageCode,
} from '../types'
import { languageColor } from '../languageDisplay'
import './Conversation.css'

type Side = 'left' | 'right'

/**
 * Which participant said this turn. The language a turn was interpreted *into*
 * names the listener, so the speaker sits on the other side of the canvas.
 * Falls back to the spoken language when a turn never needed interpreting.
 */
function turnSide(
  turn: ConversationTurn,
  leftCode: string | null,
  rightCode: string,
): Side {
  if (turn.targetLanguage) {
    if (languageCodesMatch(turn.targetLanguage, rightCode)) return 'left'
    if (leftCode && languageCodesMatch(turn.targetLanguage, leftCode)) {
      return 'right'
    }
  }
  if (turn.sourceLanguage) {
    if (leftCode && languageCodesMatch(turn.sourceLanguage, leftCode)) {
      return 'left'
    }
    if (languageCodesMatch(turn.sourceLanguage, rightCode)) return 'right'
  }
  return 'left'
}

function scriptClass(code: string): string {
  // Nastaliq renders small at a given point size and needs the line height.
  return languageCodesMatch(code, 'ur') ? ' urdu-text' : ''
}

function Turn({
  turn,
  index,
  fallbackTarget,
}: {
  turn: ConversationTurn
  index: number
  fallbackTarget: string
}) {
  const source = languageMetaFromCode(turn.sourceLanguage ?? 'und')
  const target = languageMetaFromCode(turn.targetLanguage ?? fallbackTarget)
  const live = turn.status !== 'complete'

  return (
    <article
      className="turn"
      data-live={live || undefined}
      style={{ '--turn-index': Math.min(index, 12) } as CSSProperties}
      aria-label={`${source.label} speaker`}
    >
      <p
        className={`turn-source${scriptClass(source.code)}`}
        lang={source.htmlLang || undefined}
        dir={source.isRtl ? 'rtl' : 'ltr'}
      >
        {turn.sourceText}
      </p>

      {turn.translatedText ? (
        <div
          className="turn-translation"
          style={
            { '--translation-color': languageColor(target.code) } as CSSProperties
          }
        >
          <p className="turn-translation-label">{target.label} translation</p>
          <p
            className={`turn-translated${scriptClass(target.code)}`}
            lang={target.htmlLang || undefined}
            dir={target.isRtl ? 'rtl' : 'ltr'}
          >
            {turn.translatedText}
          </p>
        </div>
      ) : null}
    </article>
  )
}

function Column({
  side,
  languageCode,
  speakerLabel,
  turns,
  interim,
  fallbackTarget,
}: {
  side: Side
  /** `null` while Auto has not yet learned this side's language. */
  languageCode: SupportedLanguageCode | null
  speakerLabel: string
  turns: { turn: ConversationTurn; index: number }[]
  interim: InterimTranscript | null
  fallbackTarget: string
}) {
  const meta = languageCode ? languageMetaFromCode(languageCode) : null
  const color = languageCode ? languageColor(languageCode) : null

  return (
    <div
      className={`column column-${side}`}
      style={{ '--column-color': color ?? 'var(--ink-mute)' } as CSSProperties}
    >
      <header className="column-header">
        <span className="column-dot" aria-hidden="true" />
        <h3 className="column-language" lang={meta?.htmlLang || undefined}>
          {meta?.label ?? 'Auto-detect'}
        </h3>
        <span className="column-speaker">{speakerLabel}</span>
      </header>

      <ol className="column-turns">
        {turns.map(({ turn, index }) => (
          <li key={turn.id}>
            <Turn turn={turn} index={index} fallbackTarget={fallbackTarget} />
          </li>
        ))}
        {interim ? (
          <li className="turn-ghost" aria-label="Listening">
            <p
              className="turn-source"
              lang={interim.languageCode || undefined}
            >
              {interim.text}
              <span className="ghost-tail" aria-hidden="true">
                …
              </span>
            </p>
          </li>
        ) : null}
      </ol>
    </div>
  )
}

type Props = {
  turns: ConversationTurn[]
  interimTranscript: InterimTranscript | null
  /** Left side of the canvas: the explicit or detected counterpart. */
  leftCode: SupportedLanguageCode | null
  /** Right side of the canvas: the language the session renders into. */
  rightCode: SupportedLanguageCode
}

/**
 * The conversation uses the full canvas as two people talking: one language
 * per side, each turn sitting with its speaker, its interpretation attached
 * beneath it. Newest content keeps itself in view unless the reader has
 * scrolled back into the history.
 */
export function Conversation({
  turns,
  interimTranscript,
  leftCode,
  rightCode,
}: Props) {
  const columns: Record<Side, { turn: ConversationTurn; index: number }[]> = {
    left: [],
    right: [],
  }
  turns.forEach((turn, index) => {
    columns[turnSide(turn, leftCode, rightCode)].push({ turn, index })
  })

  let interimSide: Side | null = null
  if (interimTranscript) {
    interimSide =
      leftCode &&
      languageCodesMatch(interimTranscript.languageCode, leftCode)
        ? 'left'
        : languageCodesMatch(interimTranscript.languageCode, rightCode)
          ? 'right'
          : columns.left.length <= columns.right.length
            ? 'left'
            : 'right'
  }

  const sectionRef = useRef<HTMLElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const stickToEndRef = useRef(true)

  // Follow the conversation only while the reader is already at the end.
  useEffect(() => {
    const scroller = sectionRef.current?.closest('.app-main')
    if (!scroller) return
    const onScroll = () => {
      stickToEndRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!stickToEndRef.current) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, interimTranscript])

  return (
    <section
      className="conversation"
      aria-label="Conversation transcript"
      ref={sectionRef}
    >
      <div className="conversation-columns">
        <Column
          side="left"
          languageCode={leftCode}
          speakerLabel="Speaker A"
          turns={columns.left}
          interim={interimSide === 'left' ? interimTranscript : null}
          fallbackTarget={rightCode}
        />
        <Column
          side="right"
          languageCode={rightCode}
          speakerLabel="Speaker B"
          turns={columns.right}
          interim={interimSide === 'right' ? interimTranscript : null}
          fallbackTarget={rightCode}
        />
      </div>
      <div className="conversation-end" ref={endRef} aria-hidden="true" />
    </section>
  )
}
