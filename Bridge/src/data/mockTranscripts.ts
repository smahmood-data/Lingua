import type { AppStatus, PartnerLanguage, TranscriptLine } from '../types'

// Keeping separate fixtures makes the language buttons visibly change the demo.
export const mockTranscripts: Record<PartnerLanguage, TranscriptLine[]> = {
  ur: [
    {
      id: 1,
      speaker: 'You',
      originalLanguage: 'English',
      translatedLanguage: 'Urdu',
      original: 'Hello, can you help me?',
      translated: 'ہیلو، کیا آپ میری مدد کر سکتے ہیں؟',
    },
    {
      id: 2,
      speaker: 'Speaker',
      originalLanguage: 'Urdu',
      translatedLanguage: 'English',
      original: 'جی ہاں، ضرور۔ آپ کو کیا چاہیے؟',
      translated: 'Yes, of course. What do you need?',
    },
  ],
  es: [
    {
      id: 1,
      speaker: 'You',
      originalLanguage: 'English',
      translatedLanguage: 'Spanish',
      original: 'Hello, can you help me?',
      translated: 'Hola, ¿puede ayudarme?',
    },
    {
      id: 2,
      speaker: 'Speaker',
      originalLanguage: 'Spanish',
      translatedLanguage: 'English',
      original: 'Sí, por supuesto. ¿Qué necesita?',
      translated: 'Yes, of course. What do you need?',
    },
  ],
  bn: [
    {
      id: 1,
      speaker: 'You',
      originalLanguage: 'English',
      translatedLanguage: 'Bengali',
      original: 'Hello, can you help me?',
      translated: 'হ্যালো, আপনি কি আমাকে সাহায্য করতে পারেন?',
    },
    {
      id: 2,
      speaker: 'Speaker',
      originalLanguage: 'Bengali',
      translatedLanguage: 'English',
      original: 'হ্যাঁ, অবশ্যই। আপনার কী প্রয়োজন?',
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
