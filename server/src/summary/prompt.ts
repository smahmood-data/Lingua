import type { SummarizeRequest, TranscriptTurn } from './contract.ts'

export const SUMMARY_SYSTEM_INSTRUCTION = [
  'You summarise a two-way interpreted conversation for someone who is not fluent in English',
  'and who has just been through a high-stakes appointment with a school, clinic, landlord,',
  'bank, or government office.',
  '',
  'Rules:',
  '- Extract only what was actually said. Never infer, complete, or guess a detail.',
  '- If the conversation does not mention a category, return an empty array for it.',
  '- Never write "not mentioned", "none", "N/A", or any other placeholder as an array entry.',
  '- Keep every entry short, concrete, and actionable: a date, a time, a place, a document, a step.',
  '- Preserve numbers, dates, times, addresses, and document names exactly as spoken.',
  '- Put anything that was ambiguous, half-heard, or contradictory into "clarifications",',
  '  phrased as a question the user could ask to resolve it.',
].join('\n')

const SPEAKER_LABEL: Record<TranscriptTurn['speaker'], string> = {
  user: 'User',
  other: 'Service provider',
}

/**
 * Renders the transcript for the model. Each turn shows the original speech
 * and, when it differs, the interpreted text, so the model can recover
 * details that one side of the interpretation may have flattened.
 */
export function renderTranscript(turns: readonly TranscriptTurn[]): string {
  return turns
    .filter((turn) => turn.original.trim().length > 0)
    .map((turn) => {
      const original = turn.original.trim()
      const translated = turn.translated.trim()
      const label = SPEAKER_LABEL[turn.speaker]

      return translated.length > 0 && translated !== original
        ? `${label}: ${original}\n${label} (interpreted): ${translated}`
        : `${label}: ${original}`
    })
    .join('\n')
}

export function buildSummaryPrompt(request: SummarizeRequest): string {
  return [
    `Write every string in your response in this language: ${request.readingLanguage}.`,
    'Category names stay in English because they are object keys, but their values do not.',
    '',
    'Conversation transcript:',
    renderTranscript(request.turns),
  ].join('\n')
}
