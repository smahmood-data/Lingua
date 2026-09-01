import type {
  ConversationPhase,
  SessionLifecycle,
  SessionState,
} from './types'

/**
 * How the two independent things a session tracks combine into one state.
 *
 * The lifecycle is about resources: whether a microphone and Live sockets are
 * held. The phase is about the conversation: whether someone is speaking, being
 * interpreted, or being listened to. Keeping them apart is deliberate — the
 * previous transition table made every conversation event a state-machine edge,
 * so a phase change that arrived in an unexpected order was silently dropped
 * and the session stayed busy forever.
 */
export function deriveSessionState(
  lifecycle: SessionLifecycle,
  phase: ConversationPhase,
): SessionState {
  if (lifecycle === 'stopped') return 'stopped'
  if (lifecycle === 'connecting') return 'connecting'
  if (lifecycle === 'error') return 'error'
  return phase
}

/** A session may only be started from a resting lifecycle. */
export function canStart(lifecycle: SessionLifecycle): boolean {
  return lifecycle === 'stopped' || lifecycle === 'error'
}

/** True while microphone and Live resources are expected to be held. */
export function isSessionActive(state: SessionState): boolean {
  return (
    state === 'connecting' ||
    state === 'listening' ||
    state === 'translating' ||
    state === 'playing'
  )
}
