import type { AppStatus, TranscriptLine } from '../types'
import './Transcript.css'

function speakerVariant(speaker: string) {
  return speaker === 'Speaker 2' ? 'b' : 'a'
}

function langAttr(language: 'English' | 'Urdu') {
  return language === 'Urdu' ? 'ur' : 'en'
}

function Turn({ line, index }: { line: TranscriptLine; index: number }) {
  return (
    <article
      className="turn"
      style={{ '--turn-index': index } as React.CSSProperties}
      aria-label={`${line.speaker}, ${line.originalLanguage}`}
    >
      <header className="turn-meta">
        <span
          className={`speaker-dot speaker-${speakerVariant(line.speaker)}`}
          aria-hidden="true"
        />
        <span className="turn-speaker">{line.speaker}</span>
        <span className="turn-language">{line.originalLanguage}</span>
      </header>

      <p
        className={`turn-original ${
          line.originalLanguage === 'Urdu' ? 'urdu-text' : ''
        }`}
        lang={langAttr(line.originalLanguage)}
        dir={line.originalLanguage === 'Urdu' ? 'rtl' : 'ltr'}
      >
        {line.original}
      </p>

      <div className="turn-translation">
        <span className="translation-label">
          {line.translatedLanguage} translation
        </span>
        <p
          className={`turn-translated ${
            line.translatedLanguage === 'Urdu' ? 'urdu-text' : ''
          }`}
          lang={langAttr(line.translatedLanguage)}
          dir={line.translatedLanguage === 'Urdu' ? 'rtl' : 'ltr'}
        >
          {line.translated}
        </p>
      </div>
    </article>
  )
}

function MicGlyph() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EmptyState() {
  return (
    <div className="transcript-empty">
      <span className="empty-icon">
        <MicGlyph />
      </span>
      <p className="empty-title">Ready when you are</p>
      <p className="empty-body">
        Start the conversation and Lingua translates live between English and{' '}
        <span lang="ur" className="urdu-text-inline">
          اردو
        </span>
        . What each person says appears here, with the translation alongside.
      </p>
    </div>
  )
}

function ConnectingState() {
  return (
    <div className="transcript-empty">
      <span className="empty-spinner" aria-hidden="true" />
      <p className="empty-title">Connecting to the interpreter…</p>
      <p className="empty-body">
        Requesting the microphone and opening a translation session.
      </p>
    </div>
  )
}

function ListeningFooter({ sourceLanguage }: { sourceLanguage: string }) {
  return (
    <div className="listening-footer" role="status">
      <span className="listening-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <p>
        Listening — speak in {sourceLanguage} and the translation appears here.
      </p>
    </div>
  )
}

type Props = {
  status: AppStatus
  lines: TranscriptLine[]
  sourceLanguage: string
}

export function Transcript({ status, lines, sourceLanguage }: Props) {
  // Interrupted sessions keep their transcript; states that never started
  // (ready, connecting, mic blocked) show an intentional placeholder instead.
  const showTurns =
    status === 'listening' || status === 'disconnected' || status === 'error'

  return (
    <section
      className={`transcript ${showTurns ? '' : 'transcript-placeholder'}`}
      aria-label="Transcript"
    >
      <h2 className="sr-only">Conversation transcript</h2>

      {!showTurns && status === 'loading' ? (
        <ConnectingState />
      ) : !showTurns ? (
        <EmptyState />
      ) : (
        <ol className="turn-list">
          {lines.map((line, index) => (
            <li key={line.id}>
              <Turn line={line} index={index} />
            </li>
          ))}
          {status === 'listening' && (
            <li>
              <ListeningFooter sourceLanguage={sourceLanguage} />
            </li>
          )}
        </ol>
      )}
    </section>
  )
}
