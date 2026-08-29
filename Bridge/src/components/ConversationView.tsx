import { useRef } from 'react'
import type {
  ConversationTurn,
  InterimTranscript,
  SessionError,
} from '../lib/translation'
import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'
import { AUTO_ACCENT, languageAccent } from '../languageAccents'
import { useAnchoredScroll } from '../hooks/useAnchoredScroll'
import type { UiState } from '../uiState'
import { StatusNotice } from './StatusNotice'
import './ConversationView.css'

function isRtlCode(code: string | null | undefined): boolean {
  return code ? languageMetaFromCode(code).isRtl : false
}

function scriptClass(code: string | null | undefined): string {
  return code === 'ur' ? 'urdu-text' : ''
}

/** What the live turn's chip says — the same words the console uses. */
function liveChipLabel(turn: ConversationTurn): string {
  switch (turn.status) {
    case 'speaking':
      return 'Listening'
    case 'translating':
      return 'Translating'
    case 'playing':
      return 'Playing'
    default:
      return ''
  }
}

function TurnView({
  turn,
  interim,
}: {
  turn: ConversationTurn
  /** Live caption, shown only while the open turn has no words of its own. */
  interim: InterimTranscript | null
}) {
  const isLive = turn.status !== 'complete'
  const sourceCode = turn.sourceLanguage ?? (isLive ? interim?.languageCode : null)
  const source = sourceCode ? languageMetaFromCode(sourceCode) : null
  const target = turn.targetLanguage
    ? languageMetaFromCode(turn.targetLanguage)
    : null
  const sourceAccent = sourceCode ? languageAccent(sourceCode) : AUTO_ACCENT
  const targetAccent = turn.targetLanguage
    ? languageAccent(turn.targetLanguage)
    : null

  const sourceText = turn.sourceText || (isLive ? (interim?.text ?? '') : '')
  const chip = isLive ? liveChipLabel(turn) : ''

  return (
    <article className={`turn${isLive ? ' turn-live' : ''}`}>
      <header className="turn-meta">
        <span
          className="turn-dot"
          style={{ background: sourceAccent.strong }}
          aria-hidden="true"
        />
        <span
          className="turn-lang"
          style={{ color: sourceAccent.strong }}
          lang={source?.htmlLang || undefined}
        >
          {source?.label ?? 'Detecting…'}
        </span>
        {target && targetAccent ? (
          <>
            <span className="turn-arrow" aria-hidden="true">
              →
            </span>
            <span
              className="turn-lang"
              style={{ color: targetAccent.strong }}
              lang={target.htmlLang}
            >
              {target.label}
            </span>
          </>
        ) : null}
        {chip ? (
          <span className={`turn-chip chip-${turn.status}`}>
            <span className="turn-chip-dot" aria-hidden="true" />
            {chip}
          </span>
        ) : null}
      </header>

      {sourceText ? (
        <p
          className={`turn-source ${scriptClass(sourceCode)}${!turn.sourceText ? ' turn-source-interim' : ''}`}
          lang={source?.htmlLang || undefined}
          dir={isRtlCode(sourceCode) ? 'rtl' : 'ltr'}
        >
          {sourceText}
        </p>
      ) : null}

      {turn.translatedText && targetAccent ? (
        <p
          className={`turn-target ${scriptClass(turn.targetLanguage)}`}
          style={{ '--target-accent': targetAccent.strong } as React.CSSProperties}
          lang={target?.htmlLang || undefined}
          dir={isRtlCode(turn.targetLanguage) ? 'rtl' : 'ltr'}
        >
          {turn.translatedText}
        </p>
      ) : isLive && turn.status === 'translating' && targetAccent ? (
        <span
          className="turn-shimmer"
          style={{ '--target-accent': targetAccent.strong } as React.CSSProperties}
          aria-hidden="true"
        />
      ) : null}
    </article>
  )
}

function EmptyState({
  sourceLanguage,
  targetLanguage,
}: {
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
}) {
  const source =
    sourceLanguage === AUTO_SOURCE_LANGUAGE
      ? null
      : languageMetaFromCode(sourceLanguage)
  const target = languageMetaFromCode(targetLanguage)
  return (
    <div className="conversation-empty">
      <p className="empty-title">A conversation, interpreted</p>
      <p className="empty-body">
        {source ? (
          <>
            Speak <span lang={source.htmlLang}>{source.label}</span> or{' '}
            <span lang={target.htmlLang}>{target.label}</span> — Lingua
            interprets both ways, aloud and on screen.
          </>
        ) : (
          <>
            Speak any language — Lingua detects it and interprets into{' '}
            <span lang={target.htmlLang}>{target.label}</span>, aloud and on
            screen.
          </>
        )}
      </p>
      <p className="empty-cue">
        Tap the microphone to begin
        <span className="empty-cue-arrow" aria-hidden="true">
          ↓
        </span>
      </p>
    </div>
  )
}

function ActivePlaceholder() {
  return (
    <div className="conversation-empty" aria-hidden="true">
      <p className="empty-active">
        <span className="active-dots">
          <span />
          <span />
          <span />
        </span>
        The conversation will appear here
      </p>
    </div>
  )
}

type Props = {
  state: UiState
  turns: ConversationTurn[]
  interimTranscript: InterimTranscript | null
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  error: SessionError | null
}

export function ConversationView({
  state,
  turns,
  interimTranscript,
  sourceLanguage,
  targetLanguage,
  error,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastTurn = turns[turns.length - 1]
  const tailKey = `${state}:${turns.length}:${lastTurn?.id ?? ''}:${
    lastTurn?.sourceText.length ?? 0
  }:${lastTurn?.translatedText.length ?? 0}:${interimTranscript?.text.length ?? 0}`
  const { handleScroll, showJump, jumpToLatest } = useAnchoredScroll(
    scrollRef,
    tailKey,
  )

  // Turns are append-only and keyed by a stable id, so each article mounts
  // exactly once: its entrance animation runs on arrival and never again,
  // however often the words inside it grow.
  const sessionLive =
    state === 'listening' || state === 'translating' || state === 'playing'
  const showTurns = turns.length > 0 || sessionLive

  return (
    <>
      <div
        className="conversation-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        <section
          className="conversation"
          aria-labelledby="conversation-heading"
        >
          <h2 id="conversation-heading" className="sr-only">
            Conversation transcript
          </h2>

          {error ? <StatusNotice error={error} /> : null}

          {!showTurns ? (
            <EmptyState
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
            />
          ) : (
            <>
              <ol className="turn-list">
                {turns.map((turn) => (
                  <li key={turn.id}>
                    <TurnView
                      turn={turn}
                      interim={
                        turn.status !== 'complete' ? interimTranscript : null
                      }
                    />
                  </li>
                ))}
              </ol>
              {turns.length === 0 && sessionLive ? <ActivePlaceholder /> : null}
            </>
          )}
        </section>
      </div>

      {showJump ? (
        <button
          type="button"
          className="jump-latest"
          onClick={jumpToLatest}
          aria-label="Jump to the latest message"
        >
          Latest <span aria-hidden="true">↓</span>
        </button>
      ) : null}
    </>
  )
}
