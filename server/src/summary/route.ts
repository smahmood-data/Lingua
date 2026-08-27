import { Router } from 'express'
import { hasSpokenContent, summarizeRequestSchema } from './contract.ts'
import { SummaryError, type Summarizer } from './summarize.ts'

/**
 * Every failure answers with { error: { code, message } } so the client can
 * switch on a stable code instead of pattern-matching prose.
 */
export function createSummaryRouter(summarize: Summarizer): Router {
  const router = Router()

  router.post('/summarize', async (req, res) => {
    const request = summarizeRequestSchema.safeParse(req.body)

    if (!request.success) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: 'The transcript payload does not match the expected shape.',
        },
      })
      return
    }

    // An empty conversation is a normal way to end a session, not a fault.
    // It never reaches Gemini, so there is nothing to invent from.
    if (!hasSpokenContent(request.data.turns)) {
      res.status(422).json({
        error: {
          code: 'empty_transcript',
          message: 'There is nothing to summarise yet.',
        },
      })
      return
    }

    try {
      res.json(await summarize(request.data))
    } catch (error) {
      if (error instanceof SummaryError) {
        // The client is told only the stable code; the operator needs the
        // reason. `detail` is upstream context only — never the transcript.
        console.error(`Summary failed (${error.code}): ${error.message}`, error.detail)
        res.status(502).json({ error: { code: error.code, message: error.message } })
        return
      }

      console.error('Unexpected failure while summarising the conversation', error)
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'The summary could not be generated.',
        },
      })
    }
  })

  return router
}
