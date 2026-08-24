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
