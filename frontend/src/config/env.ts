/**
 * Флаги окружения.
 *
 * ЧАСТЬ 2, п.8 — верхний бар с переключением экранов существует только в DEV-сборке.
 * В PROD его место занимает обычный хедер с кнопкой меню внутри самих экранов.
 */

/** true в `pnpm dev`, false в `pnpm build`. */
export const IS_DEV = import.meta.env.DEV

/**
 * Показывать ли DEV-бар навигации по экранам.
 *
 * По умолчанию: включён в `npm run dev`, выключен в `npm run build`.
 * `VITE_DEV_BAR=off` — выключить в dev.
 * `VITE_DEV_BAR=on`  — включить в собранной версии. Нужно ТОЛЬКО для
 *   review-сборки, которую смотрит заказчик. В релизной сборке эту
 *   переменную задавать нельзя.
 */
export const SHOW_DEV_BAR =
  import.meta.env.VITE_DEV_BAR === 'on' || (IS_DEV && import.meta.env.VITE_DEV_BAR !== 'off')

/**
 * Разрешён ли вход без Telegram (служебный маршрут /api/auth/dev).
 * Нужен, чтобы открывать приложение в обычном браузере при разработке
 * и в review-сборке. Привязан к тому же флагу, что и DEV-бар: в релизе
 * ни того, ни другого нет.
 */
export const ALLOW_DEV_LOGIN = SHOW_DEV_BAR

/** Базовый URL API. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Юзернейм бота — для формирования реферальных и match-ссылок. */
export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? 'knb_bot'
