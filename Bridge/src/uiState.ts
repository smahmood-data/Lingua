/**
 * The one visual interpretation of the session lifecycle.
 *
 * Everything the interface shows about "what is happening right now" derives
 * from `UiState`, which is computed — never independently tracked — from the
 * translation session's own state, its error, and whether the person has just
 * asked for a start or stop that the session has not settled yet. There is no
 * second lifecycle here: `pending` only covers the short window in which the
 * session is still tearing down or serializing a start it has not announced.
 */
import type {
  SessionError,
  SessionErrorCode,
  SessionState,
} from './lib/translation'

export type UiState =
  | 'idle'
  | 'permission'
  | 'connecting'
  | 'listening'
  | 'translating'
  | 'playing'
  | 'stopping'
  | 'disconnected'
  | 'error'

export type PendingAction = 'start' | 'stop' | null

/** Microphone-side failures share one calm "the mic needs attention" state. */
const MICROPHONE_ERRORS: readonly SessionErrorCode[] = [
  'microphone-permission-denied',
  'microphone-unavailable',
  'unsupported-browser',
]

export function deriveUiState(
  state: SessionState,
  error: SessionError | null,
  pending: PendingAction,
): UiState {
  if (pending === 'stop' && state !== 'stopped' && state !== 'error') {
    return 'stopping'
  }
  if (error) {
    if (MICROPHONE_ERRORS.includes(error.code)) return 'permission'
    if (error.code === 'live-disconnected') return 'disconnected'
    return 'error'
  }
  // A start the session has accepted but not announced yet looks like what it
  // is: connecting.
  if (pending === 'start' && state === 'stopped') return 'connecting'
  switch (state) {
    case 'connecting':
      return 'connecting'
    case 'listening':
      return 'listening'
    case 'translating':
      return 'translating'
    case 'playing':
      return 'playing'
    default:
      return 'idle'
  }
}

/** Whether a tap on the microphone can meaningfully do anything right now. */
export function micIsBusy(state: UiState): boolean {
  return state === 'connecting' || state === 'stopping'
}

/** Whether the session is up and a tap ends it. */
export function micIsActive(state: UiState): boolean {
  return state === 'listening' || state === 'translating' || state === 'playing'
}

export function micActionLabel(state: UiState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting to the interpreter'
    case 'stopping':
      return 'Ending the conversation'
    case 'listening':
    case 'translating':
    case 'playing':
      return 'End the conversation'
    case 'permission':
    case 'disconnected':
    case 'error':
      return 'Try again'
    default:
      return 'Start interpreting'
  }
}

/** Language names the console copy can refer to. */
export interface ConsoleLanguages {
  /** The configured source side, or `null` in Auto mode. */
  source: string | null
  /** The configured target side. */
  target: string
  /** The counterpart Auto has detected, when it has. */
  detected: string | null
  /** The language the current turn is being rendered into, when known. */
  liveTarget: string | null
}

export interface ConsoleCopy {
  primary: string
  helper: string | null
}

/** What the console says under the microphone in each state. */
export function consoleCopy(
  state: UiState,
  languages: ConsoleLanguages,
): ConsoleCopy {
  const { source, target, detected, liveTarget } = languages
  switch (state) {
    case 'connecting':
      return {
        primary: 'Connecting…',
        helper: 'Opening a secure interpretation session.',
      }
    case 'listening':
      return {
        primary: 'Listening…',
        helper: source
          ? `Speak ${source} or ${target} — either person can start.`
          : detected
            ? `Speak ${detected} or ${target} — either person can start.`
            : 'Speak any language — Lingua will detect it.',
      }
    case 'translating':
      return {
        primary: `Translating to ${liveTarget ?? target}…`,
        helper: null,
      }
    case 'playing':
      return { primary: `Speaking ${liveTarget ?? target}…`, helper: null }
    case 'stopping':
      return { primary: 'Ending…', helper: null }
    case 'permission':
      return {
        primary: 'Microphone access needed',
        helper: 'Allow the microphone, then tap to try again.',
      }
    case 'disconnected':
      return {
        primary: 'Connection lost',
        helper: 'Tap the microphone to reconnect.',
      }
    case 'error':
      return {
        primary: 'Something went wrong',
        helper: 'Tap the microphone to try again.',
      }
    default:
      return {
        primary: 'Ready when you are',
        helper: source
          ? `Tap the microphone — speak ${source} or ${target}.`
          : `Tap the microphone — speak any language, hear ${target}.`,
      }
  }
}

/** One-word readout for the header status chip. */
export function statusChipLabel(state: UiState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting'
    case 'listening':
      return 'Listening'
    case 'translating':
      return 'Translating'
    case 'playing':
      return 'Speaking'
    case 'stopping':
      return 'Ending'
    case 'permission':
      return 'Mic off'
    case 'disconnected':
      return 'Offline'
    case 'error':
      return 'Error'
    default:
      return 'Ready'
  }
}

export type NoticeTone = 'warning' | 'danger'

export interface NoticeCopy {
  title: string
  detail: string
  tone: NoticeTone
}

/** Calm, specific problem copy with the recovery step that actually exists. */
export function noticeCopy(error: SessionError): NoticeCopy {
  const retry = 'Tap the microphone to try again.'
  switch (error.code) {
    case 'microphone-permission-denied':
      return {
        title: 'Microphone access is off',
        detail: `Allow microphone access for this site in your browser settings, then tap the microphone to try again.`,
        tone: 'warning',
      }
    case 'microphone-unavailable':
      return {
        title: 'No microphone available',
        detail: `Connect or enable a microphone, then ${retry.charAt(0).toLowerCase()}${retry.slice(1)}`,
        tone: 'warning',
      }
    case 'unsupported-browser':
      return {
        title: 'This browser can’t run live interpretation',
        detail: 'Try a current version of Chrome, Edge, or Safari.',
        tone: 'warning',
      }
    case 'token-request-failed':
      return {
        title: 'The secure session could not start',
        detail: `Check your connection, then ${retry.charAt(0).toLowerCase()}${retry.slice(1)}`,
        tone: 'danger',
      }
    case 'live-connection-failed':
      return {
        title: 'The interpreter could not be reached',
        detail: `Check your connection, then ${retry.charAt(0).toLowerCase()}${retry.slice(1)}`,
        tone: 'danger',
      }
    case 'live-disconnected':
      return {
        title: 'Connection lost',
        detail:
          'The conversation paused. Check your network, then tap the microphone to reconnect.',
        tone: 'danger',
      }
    default:
      return {
        title: 'Something went wrong',
        detail: `${error.message} ${retry}`,
        tone: 'danger',
      }
  }
}
