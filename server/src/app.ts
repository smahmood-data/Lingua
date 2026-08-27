import cors from 'cors'
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { createSummaryRouter } from './summary/route.ts'
import type { Summarizer } from './summary/summarize.ts'

/**
 * Body-parser rejections (malformed JSON, an oversized transcript) are thrown
 * before any route runs, so without this shape they reach Express's default
 * handler and answer with an HTML page containing a stack trace and server
 * paths. The client switches on `error.code`, so every failure has to be JSON.
 */
type HttpError = Error & { status?: number; statusCode?: number; type?: string }

function errorHandler(error: HttpError, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error)
    return
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'payload_too_large',
        message: 'The conversation is too long to summarise.',
      },
    })
    return
  }

  const status = error.status ?? error.statusCode
  if (error.type === 'entity.parse.failed' || status === 400) {
    res.status(400).json({
      error: {
        code: 'invalid_request',
        message: 'The transcript payload does not match the expected shape.',
      },
    })
    return
  }

  console.error('Unhandled server error', error)
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'The summary could not be generated.',
    },
  })
}

export function createApp(options: {
  summarize: Summarizer
  clientOrigin: string
}): Express {
  const app = express()

  app.use(cors({ origin: options.clientOrigin }))
  // Transcripts are text only; the cap keeps a runaway session from
  // becoming an unbounded request body.
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/api', createSummaryRouter(options.summarize))

  app.use(errorHandler)

  return app
}
