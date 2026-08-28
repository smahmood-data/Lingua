import type { AppStatus, TranscriptLine } from '../types'

// Preview fixture for the default auto-detect → English route.
export const mockTranscripts: TranscriptLine[] = [
  {
    id: 1,
    speaker: 'Urdu speaker',
    originalLanguage: 'Urdu',
    originalLanguageCode: 'ur',
    translatedLanguage: 'English',
    translatedLanguageCode: 'en',
    original: 'ہیلو، کیا آپ میری مدد کر سکتے ہیں؟',
    translated: 'Hello, can you help me?',
  },
  {
    id: 2,
    speaker: 'Spanish speaker',
    originalLanguage: 'Spanish',
    originalLanguageCode: 'es',
    translatedLanguage: 'English',
    translatedLanguageCode: 'en',
    original: 'Sí, por supuesto. ¿Qué necesita?',
    translated: 'Yes, of course. What do you need?',
  },
]

export type StatusTone = 'idle' | 'active' | 'busy' | 'warning' | 'danger'

export type StatusMeta = {
  // Short label shown next to the status dot in the top bar.
  label: string
  tone: StatusTone
  // Problem states also carry a notice with a title and a next step.
  noticeTitle?: string
  noticeDetail?: string
}

export const statusMeta: Record<AppStatus, StatusMeta> = {
  ready: { label: 'Ready', tone: 'idle' },
  listening: { label: 'Listening', tone: 'active' },
  loading: { label: 'Connecting', tone: 'busy' },
  disconnected: {
    label: 'Disconnected',
    tone: 'danger',
    noticeTitle: 'Connection lost',
    noticeDetail: 'Check your network connection, then start the conversation again.',
  },
  denied: {
    label: 'Mic blocked',
    tone: 'warning',
    noticeTitle: 'Microphone access was denied',
    noticeDetail:
      'Allow the microphone for this site in your browser settings, then start again.',
  },
  error: {
    label: 'Translation error',
    tone: 'danger',
    noticeTitle: 'Something went wrong with translation',
    noticeDetail: 'End the conversation and start again. If this repeats, check your connection.',
  },
}
