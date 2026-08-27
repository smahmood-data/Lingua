import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LiveTranslationDemo } from './components/LiveTranslationDemo.tsx'

// `?live=1` opens the issue #2 audio harness. The main screen is owned by issue
// #4, so it is left untouched here.
const showLiveDemo = new URLSearchParams(window.location.search).has('live')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{showLiveDemo ? <LiveTranslationDemo /> : <App />}</StrictMode>,
)
