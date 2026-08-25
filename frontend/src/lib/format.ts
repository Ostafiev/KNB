import type { Lang } from '../types'

/** Относительное время «2 мин назад» / «2 min ago» без внешних зависимостей. */
export function formatRelative(minutesAgo: number, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (minutesAgo < 60) return rtf.format(-minutesAgo, 'minute')
  if (minutesAgo < 60 * 24) return rtf.format(-Math.round(minutesAgo / 60), 'hour')
  return rtf.format(-Math.round(minutesAgo / (60 * 24)), 'day')
}

export function formatCoins(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')
}

/**
 * Склонение слова «раунд»: 1 раунд, 2–4 раунда, 5+ раундов.
 * Без этого в интерфейсе появляется «3 раундов».
 */
export function formatRounds(count: number, lang: Lang): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'round' : 'rounds'}`
  const mod10 = count % 10
  const mod100 = count % 100
  let word = 'раундов'
  if (mod10 === 1 && mod100 !== 11) word = 'раунд'
  else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) word = 'раунда'
  return `${count} ${word}`
}
