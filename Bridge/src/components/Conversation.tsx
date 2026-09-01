import { useEffect, useRef, type CSSProperties } from 'react'
import type { ConversationTurn, InterimTranscript } from '../lib/translation'
import {
  languageCodesMatch,
  languageMetaFromCode,
  type SupportedLanguageCode,
} from '../types'
import { languageColor } from '../languageDisplay'
import './Conversation.css'

type Side = 'left' | 'right'

/**
 * Which participant said this turn.
 *
 * The spoken language answers it directly. Before that is known, the language
 * the turn is being rendered *into* names the listener, so the speaker is the
 * other side of the conversation.
 */
function turnSide(
  turn: Pick<ConversationTurn, 'sourceLanguage' | 'targetLanguage'>,
  leftCode: string | null,
  rightCode: string,
): Side {
  if (turn.sourceLanguage) {
    if (leftCode && languageCodesMatch(turn.sourceLanguage, leftCode)) {
      return 'left'
    }
    if (languageCodesMatch(turn.sourceLanguage, rightCode)) return 'right'
  }
  if (turn.targetLanguage) {
    if (languageCodesMatch(turn.targetLanguage, rightCode)) return 'left'
    if (leftCode && languageCodesMatch(turn.targetLanguage, leftCode)) {
      return 'right'
    }
  }
  return 'left'
}

function scriptClass(code: string): string {
  // Nastaliq renders small at a given point size and needs the line height.
  return languageCodesMatch(code, 'ur') ? ' urdu-text' : ''
}

/** What the live marker on an unfinished turn says. */
function liveLabel(status: ConversationTurn['status']): string | null {
  switch (status) {
    case 'speaking':
      return 'Listening'
    case 'translating':
      return 'Translating'
    case 'playing':
      return 'Playing'
    default:
      return null
  }
}

function Turn({
  turn,
  side,
  interim,
}: {
  turn: ConversationTurn
  side: Side
  /** Live caption, used only while the open turn has no words of its own. */
  interim: InterimTranscript | null
}) {
  const live = turn.status !== 'complete'
  const sourceCode = turn.sourceLanguage ?? interim?.languageCode ?? null
  const source = sourceCode ? languageMetaFromCode(sourceCode) : null
  const target = turn.targetLanguage
    ? languageMetaFromCode(turn.targetLanguage)
    : null

  const sourceText = turn.sourceText || interim?.text || ''
  const provisional = !turn.sourceText && Boolean(interim?.text)
  const marker = live ? liveLabel(turn.status) : null

  return (
    <article
      className="turn"
      data-side={side}
      data-live={live || undefined}
      style={
        {
          '--speaker-accent': sourceCode
            ? languageColor(sourceCode)
            : 'var(--ink-mute)',
          '--translation-accent': turn.targetLanguage
            ? languageColor(turn.targetLanguage)
            : 'var(--ink-mute)',
        } as CSSProperties
      }
    >
      <header className="turn-who">
        <span className="turn-dot" aria-hidden="true" />
        <span className="turn-who-name" lang={source?.htmlLang || undefined}>
          {source ? `${source.label} speaker` : 'Detecting language'}
        </span>
        {marker ? (
          <span className="turn-live">
            <span className="turn-live-dot" aria-hidden="true" />
            {marker}
          </span>
        ) : null}
      </header>

      {sourceText ? (
        <p
          className={`turn-said${provisional ? ' turn-said-provisional' : ''}${scriptClass(source?.code ?? '')}`}
          lang={source?.htmlLang || undefined}
          dir={source?.isRtl ? 'rtl' : 'ltr'}
        >
          {sourceText}
        </p>
      ) : null}

      {turn.translatedText && target ? (
        <div className="turn-into">
          <p className="turn-into-label">{target.label} translation</p>
          <p
            className={`turn-heard${scriptClass(target.code)}`}
            lang={target.htmlLang || undefined}
            dir={target.isRtl ? 'rtl' : 'ltr'}
          >
            {turn.translatedText}
          </p>
        </div>
      ) : live && turn.status === 'translating' ? (
        <div className="turn-into">
          <span className="turn-pending" aria-hidden="true" />
        </div>
      ) : null}
    </article>
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
 * The conversation uses the whole canvas as two people talking: one lane per
 * participant, every turn sitting with whoever said it, its interpretation
 * attached underneath. Turns stay in the order they were spoken — a reply must
 * never appear above the line it answers — so the two lanes read as one
 * conversation rather than two parallel transcripts.
 */
export function Conversation({
  turns,
  interimTranscript,
  leftCode,
  rightCode,
}: Props) {
  const openTurn = turns.findLast((turn) => turn.status !== 'complete')
  // The live caption belongs to the open turn until that turn has words of its
  // own; with no open turn at all it trails the thread as a ghost.
  const captionForOpenTurn =
    openTurn && !openTurn.sourceText ? interimTranscript : null
  const ghost = !openTurn && interimTranscript?.text ? interimTranscript : null

  const scrollerRef = useRef<HTMLElement | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const stickToEndRef = useRef(true)

  // Follow the conversation only while the reader is already at the end.
  useEffect(() => {
    const scroller = sectionRef.current?.closest('.app-main')
    if (!(scroller instanceof HTMLElement)) return
    scrollerRef.current = scroller
    const onScroll = () => {
      stickToEndRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  /*
    Scroll the container itself rather than an element into view: the room
    reserved for the session bar is the scroller's own bottom padding, so
    running to the end is what puts the newest turn clear of the bar. Jumping
    rather than gliding is deliberate — a live caption updates many times a
    second, and a smooth scroll restarted that often is just jitter.
  */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !stickToEndRef.current) return
    scroller.scrollTop = scroller.scrollHeight
  }, [turns, interimTranscript])

  return (
    <section
      className="conversation"
      aria-label="Conversation transcript"
      ref={sectionRef}
    >
      <ol className="thread">
        {turns.map((turn) => (
          <li key={turn.id} className="thread-row">
            <Turn
              turn={turn}
              side={turnSide(turn, leftCode, rightCode)}
              interim={turn === openTurn ? captionForOpenTurn : null}
            />
          </li>
        ))}

        {ghost ? (
          <li className="thread-row">
            <article
              className="turn turn-ghost"
              data-side={turnSide(
                { sourceLanguage: ghost.languageCode, targetLanguage: null },
                leftCode,
                rightCode,
              )}
              style={
                {
                  '--speaker-accent': ghost.languageCode
                    ? languageColor(ghost.languageCode)
                    : 'var(--ink-mute)',
                } as CSSProperties
              }
              aria-label="Listening"
            >
              <header className="turn-who">
                <span className="turn-dot" aria-hidden="true" />
                <span className="turn-who-name">Listening</span>
              </header>
              <p className="turn-said turn-said-provisional">{ghost.text}</p>
            </article>
          </li>
        ) : null}
      </ol>
    </section>
  )
}
