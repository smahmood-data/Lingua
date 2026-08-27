import type { CSSProperties } from 'react'
import { useTranslationSession } from '../hooks/useTranslationSession'
import type { SessionState, TranslationDirection } from '../lib/translation'

/**
 * Temporary harness for manually exercising both translation directions in a
 * browser. It is intentionally plain: the real interpreter screen is Issue #4,
 * and this component should be deleted once that lands.
 *
 * Reachable at `/?live=1` — see `src/main.tsx`.
 */

const DIRECTION_LABELS: Record<
  'ur-to-en' | 'en-to-ur',
  { label: string; source: string; target: string }
> = {
  'ur-to-en': { label: 'Urdu → English', source: 'Urdu', target: 'English' },
  'en-to-ur': { label: 'English → Urdu', source: 'English', target: 'Urdu' },
}

function stateLabel(
  state: SessionState,
  direction: TranslationDirection,
): string {
  const languages = DIRECTION_LABELS[direction as keyof typeof DIRECTION_LABELS]
  if (state === 'connecting') return 'Connecting…'
  if (state === 'listening') {
    return languages ? `Listening for ${languages.source}` : 'Listening'
  }
  if (state === 'translating') {
    return languages
      ? `Playing ${languages.target} translation`
      : 'Playing translation'
  }
  if (state === 'error') return 'Error'
  return 'Stopped'
}

const page: CSSProperties = {
  margin: '0 auto',
  maxWidth: '46rem',
  padding: '2rem 1.5rem',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.5,
  textAlign: 'left',
}

const controls: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  alignItems: 'center',
  flexWrap: 'wrap',
  margin: '1.5rem 0',
}

const panel: CSSProperties = {
  border: '1px solid currentColor',
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  marginTop: '1rem',
}

export function LiveTranslationDemo() {
  const {
    state,
    error,
    transcript,
    interimTranscript,
    isActive,
    direction,
    start,
    setDirection,
    stop,
    clearTranscript,
  } = useTranslationSession()

  return (
    <main style={page}>
      <h1>
        {(DIRECTION_LABELS[direction as keyof typeof DIRECTION_LABELS]?.label ??
          'Live')}{' '}
        translation
      </h1>
      <p>
        Developer harness for issues #2 and #3. Choose who is speaking, then start
        the session. Headphones are recommended so translated output is not picked
        up again by the microphone.
      </p>

      <div style={controls}>
        <label>
          Direction:{' '}
          <select
            value={direction}
            onChange={(event) =>
              void setDirection(event.target.value as TranslationDirection)
            }
          >
            {Object.entries(DIRECTION_LABELS).map(([value, copy]) => (
              <option key={value} value={value}>
                {copy.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void start(direction)}
          disabled={isActive}
        >
          Start session
        </button>
        <button type="button" onClick={() => void stop()} disabled={!isActive}>
          Stop session
        </button>
        <button
          type="button"
          onClick={clearTranscript}
          disabled={transcript.length === 0}
        >
          Clear transcript
        </button>
        <span aria-live="polite">
          <strong>Status:</strong> {stateLabel(state, direction)}
        </span>
      </div>

      {error ? (
        <div style={panel} role="alert">
          <strong>{error.code}</strong>
          <p>{error.message}</p>
          {error.recoverable ? <p>You can start another session.</p> : null}
        </div>
      ) : null}

      <section style={panel}>
        <h2>Transcript</h2>
        {transcript.length === 0 && !interimTranscript ? (
          <p>No transcript yet. Gemini sends these once it hears speech.</p>
        ) : (
          <ol>
            {transcript.map((turn) => (
              <li key={turn.id} lang={turn.languageCode}>
                <strong>
                  {turn.kind === 'source' ? 'Heard' : 'Translated'} (
                  {turn.languageCode}){turn.isFinal ? '' : ' …'}
                </strong>
                <div>{turn.text}</div>
              </li>
            ))}
          </ol>
        )}
        {interimTranscript ? (
          <p lang={interimTranscript.languageCode}>
            <em>Hearing: {interimTranscript.text}</em>
          </p>
        ) : null}
      </section>
    </main>
  )
}
