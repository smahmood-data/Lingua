import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  IdleSessionEndedNotice,
  IdleSessionNotice,
  StatusNotice,
} from './StatusNotice'

const styles = readFileSync(
  new URL('./StatusNotice.css', import.meta.url),
  'utf8',
)

describe('StatusNotice', () => {
  it('renders concise retry guidance and an accessible dismiss control', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusNotice, {
        error: {
          code: 'token-rate-limited',
          message:
            'This network has started too many live sessions. Try again in 10 minutes.',
          recoverable: true,
          retryAfterSeconds: 600,
        },
      }),
    )

    expect(markup).toContain('Live-session limit reached')
    expect(markup).toContain('Try again in 10 minutes.')
    expect(markup).toContain('aria-label="Dismiss message"')
  })

  it('renders the idle warning with speech-based keep-alive guidance', () => {
    const markup = renderToStaticMarkup(
      createElement(IdleSessionNotice, {
        endsAt: Date.now() + 30_000,
      }),
    )

    expect(markup).toContain('Session ending soon')
    expect(markup).toContain(
      'No speech detected. Speak within 30 seconds to keep this session open.',
    )
    expect(markup).toContain('aria-label="Dismiss message"')
  })

  it('renders a persistent danger notice after an idle timeout', () => {
    const markup = renderToStaticMarkup(
      createElement(IdleSessionEndedNotice),
    )

    expect(markup).toContain('notice-danger')
    expect(markup).toContain('Session ended due to inactivity')
    expect(markup).toContain('Start a new session when you’re ready.')
    expect(markup).toContain('aria-label="Dismiss message"')
  })

  it('defines a complete fade before an exiting notice is removed', () => {
    expect(styles).toMatch(
      /\.status-notice\.is-exiting[\s\S]*opacity: 0;[\s\S]*opacity 240ms/,
    )
    expect(styles).toMatch(
      /\.status-notice\.is-exiting[\s\S]*animation: notice-out 240ms/,
    )
  })

  it('removes notice motion when reduced motion is requested', () => {
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;[\s\S]*transition: none;/,
    )
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.status-notice\.is-exiting[\s\S]*translate: 0 0;/,
    )
  })
})
