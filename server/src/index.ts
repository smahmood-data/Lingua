import { createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { createGeminiSummarizer } from './summary/summarize.ts'

const env = loadEnv()

const app = createApp({
  clientOrigin: env.CLIENT_ORIGIN,
  summarize: createGeminiSummarizer({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_SUMMARY_MODEL,
  }),
})

app.listen(env.PORT, () => {
  console.log(`Lingua server listening on http://localhost:${env.PORT}`)
})
