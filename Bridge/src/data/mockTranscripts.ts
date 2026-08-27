import type { AppStatus, Direction, TranscriptLine } from '../types'

// Keeping separate fixtures makes the direction buttons visibly change the demo.
// The audio issues (#2/#3) will replace these with live session events.
export const mockTranscripts: Record<Direction, TranscriptLine[]> = {
  'ur-en': [
    {
      id: 1,
      speaker: 'Speaker 1',
      originalLanguage: 'Urdu',
      translatedLanguage: 'English',
      original: 'ہیلو، کیا آپ میری مدد کر سکتے ہیں؟',
      translated: 'Hello, can you help me?',
    },
    {
      id: 2,
      speaker: 'Speaker 2',
      originalLanguage: 'English',
      translatedLanguage: 'Urdu',
      original: 'Yes, of course. What do you need?',
      translated: 'جی ہاں، ضرور۔ آپ کو کیا چاہیے؟',
    },
  ],
  'en-ur': [
    {
      id: 1,
      speaker: 'Speaker 1',
      originalLanguage: 'English',
      translatedLanguage: 'Urdu',
      original: 'Hello, can you help me?',
      translated: 'ہیلو، کیا آپ میری مدد کر سکتے ہیں؟',
    },
    {
      id: 2,
      speaker: 'Speaker 2',
      originalLanguage: 'Urdu',
      translatedLanguage: 'English',
      original: 'جی ہاں، ضرور۔ آپ کو کیا چاہیے؟',
      translated: 'Yes, of course. What do you need?',
    },
  ],
}

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
