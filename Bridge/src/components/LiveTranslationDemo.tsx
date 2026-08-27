import type { CSSProperties } from 'react'
import { useTranslationSession } from '../hooks/useTranslationSession'
import type { SessionState } from '../lib/translation'

/**
 * Temporary harness for manually exercising the Urdu → English pipeline in a
 * browser. It is intentionally plain: the real interpreter screen is Issue #4,
 * and this component should be deleted once that lands.
 *
 * Reachable at `/?live=1` — see `src/main.tsx`.
 */

const STATE_LABELS: Record<SessionState, string> = {
  connecting: 'Connecting…',
  listening: 'Listening for Urdu',
  translating: 'Playing English translation',
  stopped: 'Stopped',
  error: 'Error',
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
  const { state, error, transcript, isActive, start, stop, clearTranscript } =
    useTranslationSession()

  return (
    <main style={page}>
      <h1>Urdu → English live translation</h1>
      <p>
        Developer harness for issue #2. Speak Urdu into the laptop microphone and
        the English translation plays through the speakers. Headphones are
        recommended so the output is not picked up again by the microphone.
      </p>

      <div style={controls}>
        <button type="button" onClick={() => void start()} disabled={isActive}>
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
          <strong>Status:</strong> {STATE_LABELS[state]}
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
        {transcript.length === 0 ? (
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
      </section>
    </main>
  )
}
