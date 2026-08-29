import type { ConversationTurn } from '../lib/translation'

// Preview fixture for the state walkthrough: one utterance, its reply, and a
// turn still in progress — the three shapes a conversation can take.
export const mockTurns: ConversationTurn[] = [
  {
    id: 'preview-1',
    sourceLanguage: 'es',
    sourceText: 'Hola, ¿me puedes ayudar con la receta de mi abuela?',
    targetLanguage: 'en',
    translatedText: 'Hello, can you help me with my grandmother’s recipe?',
    status: 'complete',
    createdAt: 1,
  },
  {
    id: 'preview-2',
    sourceLanguage: 'en',
    sourceText: 'Of course. What do you need to know?',
    targetLanguage: 'es',
    translatedText: 'Por supuesto. ¿Qué necesitas saber?',
    status: 'complete',
    createdAt: 2,
  },
]
