import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Express server from issue #1 listens on the port in `.env.example`.
// Proxying keeps `/api/live-token` same-origin in development, so the browser
// needs no server URL and no `VITE_*` configuration.
const SERVER_ORIGIN = 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: SERVER_ORIGIN,
        changeOrigin: true,
      },
    },
  },
})
