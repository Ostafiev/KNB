import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Theme } from '../types'
import { getTelegramColorScheme, getWebApp } from '../telegram/sdk'

const STORAGE_KEY = 'knb.theme'

/** Фон приложения по темам — нужен, чтобы красить хедер Telegram в тон. */
const CHROME_COLOR: Record<Theme, string> = {
  dark: '#17212b',
  light: '#eef2f7',
}

function detectTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* localStorage может быть недоступен */
  }
  // При первом входе наследуем тему клиента Telegram…
  const fromTelegram = getTelegramColorScheme()
  if (fromTelegram) return fromTelegram

  // …иначе тему хоста, если страница встроена куда-то, где она уже выставлена…
  const fromHost = document.documentElement.getAttribute('data-theme')
  if (fromHost === 'dark' || fromHost === 'light') return fromHost

  // …иначе системную настройку пользователя.
  if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

interface ThemeValue {
  theme: Theme
  isDark: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(detectTheme)

  useEffect(() => {
    // Вся палитра переключается одним атрибутом — см. src/index.css.
    document.documentElement.setAttribute('data-theme', theme)
    const chrome = CHROME_COLOR[theme]
    document.documentElement.style.colorScheme = theme
    const wa = getWebApp()
    wa?.setHeaderColor?.(chrome)
    wa?.setBackgroundColor?.(chrome)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* no-op */
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* no-op */
      }
      return next
    })
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({ theme, isDark: theme === 'dark', setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
