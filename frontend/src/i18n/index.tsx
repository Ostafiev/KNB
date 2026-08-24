import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Lang } from '../types'
import { getTelegramLocale } from '../telegram/sdk'
import { ru, type TranslationKey } from './locales/ru'
import { en } from './locales/en'

const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { ru, en }

const STORAGE_KEY = 'knb.lang'
const SUPPORTED: Lang[] = ['ru', 'en']

/** Приводит 'ru-RU' / 'en-US' к поддерживаемому языку. */
function normalize(locale: string | undefined | null): Lang | null {
  if (!locale) return null
  const base = locale.toLowerCase().split(/[-_]/)[0]
  return (SUPPORTED as string[]).includes(base) ? (base as Lang) : null
}

/**
 * Автоопределение языка при первом входе (ЧАСТЬ 2, п.12).
 * Приоритет: ручной выбор пользователя → локаль Telegram → локаль браузера → русский.
 */
export function detectLanguage(): { lang: Lang; auto: boolean } {
  try {
    const saved = normalize(localStorage.getItem(STORAGE_KEY))
    if (saved) return { lang: saved, auto: false }
  } catch {
    /* localStorage может быть недоступен */
  }
  const fromTelegram = normalize(getTelegramLocale())
  if (fromTelegram) return { lang: fromTelegram, auto: true }

  const fromBrowser = normalize(typeof navigator !== 'undefined' ? navigator.language : null)
  if (fromBrowser) return { lang: fromBrowser, auto: true }

  return { lang: 'ru', auto: true }
}

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

interface I18nValue {
  lang: Lang
  /** true, пока язык определён автоматически и не переопределён вручную. */
  isAuto: boolean
  setLang: (lang: Lang) => void
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [{ lang, auto }, setState] = useState(detectLanguage)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setState({ lang: next, auto: false })
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* no-op */
    }
  }, [])

  const t = useCallback<Translate>(
    (key, vars) => {
      const template = DICTIONARIES[lang][key] ?? ru[key] ?? key
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      )
    },
    [lang],
  )

  const value = useMemo<I18nValue>(() => ({ lang, isAuto: auto, setLang, t }), [lang, auto, setLang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}

/** Короткий хелпер: `const t = useT()`. */
export function useT(): Translate {
  return useI18n().t
}

export type { TranslationKey }
