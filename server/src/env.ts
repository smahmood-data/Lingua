import { config } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// The key lives in the repository-root .env, as the README instructs, but the
// server is started from server/. Resolving the path against this file rather
// than the working directory makes `npm run dev` work from either directory,
// and from src/ under tsx as well as dist/ after a build. Real environment
// variables still win: dotenv never overwrites what is already set.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') })

/**
 * The API key is read here and nowhere else. It must never be exposed through
 * a VITE_* variable, because Vite inlines those into the browser bundle.
 */
const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required for the summary endpoint.'),
  GEMINI_SUMMARY_MODEL: z.string().min(1).default('gemini-3.7-flash'),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ')
    throw new Error(`Invalid server environment.\n  ${details}`)
  }

  return result.data
}
