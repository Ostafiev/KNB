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
 * Можно принудительно выключить в dev: VITE_DEV_BAR=off
 * Принудительно включить в проде нельзя — это защита от утечки бара в релиз.
 */
export const SHOW_DEV_BAR = IS_DEV && import.meta.env.VITE_DEV_BAR !== 'off'

/** Базовый URL API. TODO(backend): подставить реальный адрес из ЧАСТИ 3. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Юзернейм бота — для формирования реферальных и match-ссылок. */
export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? 'knb_bot'
