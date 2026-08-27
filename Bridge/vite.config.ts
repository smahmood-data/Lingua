import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Keeps the Gemini key server-side: the browser only ever talks to the
    // Lingua server on a same-origin /api path, never to Google directly.
    proxy: {
      '/api': {
        target: process.env.LINGUA_SERVER_ORIGIN ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
