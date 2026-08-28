import type { CSSProperties } from 'react'
import { useTranslationSession } from '../hooks/useTranslationSession'
import type { SessionState } from '../lib/translation'
import {
  AUTO_SOURCE_LANGUAGE,
  languageMetaFromCode,
  supportedLanguages,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../types'

/** Development-only harness reachable at `/?live=1`. */

function stateLabel(state: SessionState, targetLanguage: SupportedLanguageCode) {
  const target = languageMetaFromCode(targetLanguage).label
  if (state === 'connecting') return 'Connecting…'
  if (state === 'listening') return 'Listening with automatic language detection'
  if (state === 'translating') return `Playing ${target} translation`
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
    sourceLanguage,
    targetLanguage,
    start,
    setLanguages,
    stop,
    clearTranscript,
  } = useTranslationSession()
  return (
    <main style={page}>
      <h1>Two-way live translation</h1>
      <p>
        Developer harness for a two-way interpreted conversation. Auto mode
        re-detects every utterance; selecting a source pins a known language
        pair.
      </p>

      <div style={controls}>
        <label>
          From:{' '}
          <select
            value={sourceLanguage}
            onChange={(event) =>
              void setLanguages(
                event.target.value as SourceLanguageCode,
                targetLanguage,
              )
            }
          >
            <option value={AUTO_SOURCE_LANGUAGE}>Auto-detect</option>
            {supportedLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Translate into:{' '}
          <select
            value={targetLanguage}
            onChange={(event) =>
              void setLanguages(
                sourceLanguage,
                event.target.value as SupportedLanguageCode,
              )
            }
          >
            {supportedLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void start(sourceLanguage, targetLanguage)}
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
          <strong>Status:</strong> {stateLabel(state, targetLanguage)}
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
