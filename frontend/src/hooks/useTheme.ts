import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'lingua-theme'

/** A choice the person made before, if they made one and it survived. */
function storedTheme(): Theme | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    // Private browsing and blocked site data both throw here; neither is an
    // error worth surfacing, and the system preference is a fine answer.
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** Whatever the pre-paint script in the document head already decided. */
function appliedTheme(): Theme | null {
  const applied = document.documentElement.dataset.theme
  return applied === 'light' || applied === 'dark' ? applied : null
}

/**
 * The one source of truth for the interface's temperament.
 *
 * An explicit choice wins and is remembered; with no choice on record the
 * system preference decides, and the interface keeps following it until the
 * person overrides it here.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? appliedTheme() ?? systemTheme(),
  )
  const [explicit, setExplicit] = useState(() => storedTheme() !== null)

  // The root element carries the theme so tokens resolve for the whole tree,
  // including anything that escapes it. Before paint, so a toggle never shows
  // a frame of the theme being left behind.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Follow the system only while the person has not chosen for themselves.
  useEffect(() => {
    if (explicit) return
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const onChange = () => setTheme(systemTheme())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [explicit])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Remembering is a convenience; failing to remember is not a failure.
      }
      return next
    })
    setExplicit(true)
  }, [])

  return { theme, toggleTheme }
}
