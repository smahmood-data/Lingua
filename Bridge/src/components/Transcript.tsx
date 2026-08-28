import {
  languageCodesMatch,
  languageMetaFromCode,
  type AppStatus,
  type SupportedLanguageCode,
  type TranscriptLine,
} from '../types'
import './Transcript.css'

function speakerVariant(languageCode: string) {
  let hash = 0
  for (const character of languageCode) hash += character.codePointAt(0) ?? 0
  return hash % 2 === 0 ? 'a' : 'b'
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
          className={`speaker-dot speaker-${speakerVariant(line.originalLanguageCode)}`}
          aria-hidden="true"
        />
        <span className="turn-speaker">{line.speaker}</span>
        <span className="turn-language">{line.originalLanguage}</span>
      </header>

      <p
        className={`turn-original ${
          languageCodesMatch(line.originalLanguageCode, 'ur') ? 'urdu-text' : ''
        }`}
        lang={line.originalLanguageCode}
        dir={
          languageMetaFromCode(line.originalLanguageCode).isRtl ? 'rtl' : 'ltr'
        }
      >
        {line.original}
      </p>

      {line.translated ? (
        <div className="turn-translation">
          <span className="translation-label">
            {line.translatedLanguage} translation
          </span>
          <p
            className={`turn-translated ${
              languageCodesMatch(line.translatedLanguageCode, 'ur')
                ? 'urdu-text'
                : ''
            }`}
            lang={line.translatedLanguageCode}
            dir={
              languageMetaFromCode(line.translatedLanguageCode).isRtl
                ? 'rtl'
                : 'ltr'
            }
          >
            {line.translated}
          </p>
        </div>
      ) : null}
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

function EmptyState({
  targetLanguage,
}: {
  targetLanguage: SupportedLanguageCode
}) {
  const target = languageMetaFromCode(targetLanguage)
  return (
    <div className="transcript-empty">
      <span className="empty-icon">
        <MicGlyph />
      </span>
      <p className="empty-title">Ready when you are</p>
      <p className="empty-body">
        Start the conversation and speak in any supported language. Lingua
        detects it automatically, translates into{' '}
        <span lang={target.htmlLang}>{target.label}</span>, and reads the
        translation aloud.
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

function ListeningFooter({
  targetLanguage,
  caption,
  isPlaying,
}: {
  targetLanguage: SupportedLanguageCode
  caption?: string
  isPlaying?: boolean
}) {
  const target = languageMetaFromCode(targetLanguage)
  return (
    <div className="listening-footer" role="status">
      <span className="listening-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <p>
        {caption
          ? caption
          : isPlaying
            ? 'Playing the translation…'
            : `Listening — auto-detecting speech and translating into ${target.label}.`}
      </p>
    </div>
  )
}

type Props = {
  status: AppStatus
  lines: TranscriptLine[]
  targetLanguage: SupportedLanguageCode
  interimText?: string
  isPlaying?: boolean
}

export function Transcript({
  status,
  lines,
  targetLanguage,
  interimText,
  isPlaying,
}: Props) {
  // Interrupted sessions keep their transcript; states that never started
  // (ready, connecting, mic blocked) show an intentional placeholder instead.
  const showTurns =
    lines.length > 0 || status === 'listening' || status === 'disconnected'

  return (
    <section
      className={`transcript ${showTurns ? '' : 'transcript-placeholder'}`}
      aria-labelledby="transcript-heading"
    >
      <h2 id="transcript-heading" className="sr-only">
        Conversation transcript
      </h2>

      {!showTurns && status === 'loading' ? (
        <ConnectingState />
      ) : !showTurns ? (
        <EmptyState targetLanguage={targetLanguage} />
      ) : (
        <ol className="turn-list">
          {lines.map((line, index) => (
            <li key={line.id}>
              <Turn line={line} index={index} />
            </li>
          ))}
          {status === 'listening' ? (
            <li>
              <ListeningFooter
                targetLanguage={targetLanguage}
                caption={interimText}
                isPlaying={isPlaying}
              />
            </li>
          ) : null}
        </ol>
      )}
    </section>
  )
}
