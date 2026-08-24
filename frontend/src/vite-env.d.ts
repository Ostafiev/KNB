/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Выключить DEV-бар навигации по экранам: VITE_DEV_BAR=off */
  readonly VITE_DEV_BAR?: string
  /** Базовый URL backend API. */
  readonly VITE_API_BASE_URL?: string
  /** Юзернейм Telegram-бота без @. */
  readonly VITE_BOT_USERNAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
