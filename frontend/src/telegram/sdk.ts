/**
 * Тонкая обёртка над Telegram WebApp API.
 *
 * Специально без внешних зависимостей: работает и внутри Telegram, и в обычном
 * браузере (где window.Telegram отсутствует) — все методы деградируют молча.
 */

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type NotificationType = 'error' | 'success' | 'warning'

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: {
    user?: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string; photo_url?: string }
    start_param?: string
  }
  colorScheme?: 'light' | 'dark'
  ready: () => void
  expand: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  version?: string
  openTelegramLink?: (url: string) => void
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void
  HapticFeedback?: {
    impactOccurred: (style: HapticStyle) => void
    notificationOccurred: (type: NotificationType) => void
    selectionChanged: () => void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getWebApp(): TelegramWebApp | undefined {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined
}

export const isTelegram = (): boolean => Boolean(getWebApp())

/** Сырая initData — уходит на бэкенд для проверки подписи (ЧАСТЬ 3, авторизация). */
export function getInitData(): string {
  return getWebApp()?.initData ?? ''
}

export function getTelegramUser() {
  return getWebApp()?.initDataUnsafe?.user
}

/** start_param из ссылки t.me/бот?startapp=… — реферальный код или id матча. */
export function getStartParam(): string | undefined {
  return getWebApp()?.initDataUnsafe?.start_param
}

/**
 * Язык интерфейса Telegram, напр. 'ru' или 'en-US'.
 * Используется для автоопределения языка при первом входе (ЧАСТЬ 2, п.12).
 */
export function getTelegramLocale(): string | undefined {
  return getWebApp()?.initDataUnsafe?.user?.language_code
}

/** Тема, выставленная в клиенте Telegram — стартовое значение для светлой/тёмной темы. */
export function getTelegramColorScheme(): 'light' | 'dark' | undefined {
  return getWebApp()?.colorScheme
}

export function initTelegram(): void {
  const wa = getWebApp()
  if (!wa) return
  wa.ready()
  wa.expand()
}

export function haptic(style: HapticStyle = 'light'): void {
  getWebApp()?.HapticFeedback?.impactOccurred(style)
}

export function hapticNotify(type: NotificationType): void {
  getWebApp()?.HapticFeedback?.notificationOccurred(type)
}

export function hapticSelection(): void {
  getWebApp()?.HapticFeedback?.selectionChanged()
}

/**
 * Отправка приглашения в Telegram: открывается список контактов, человек
 * выбирает, кому отправить, и сообщение уходит готовым.
 *
 * Возвращает false, если открыть Telegram не удалось, — тогда экран должен
 * подсказать другой путь, а не делать вид, что всё получилось.
 */
export function shareLink(url: string, text: string): boolean {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const wa = getWebApp()

  if (wa?.openTelegramLink) {
    try {
      wa.openTelegramLink(shareUrl)
      return true
    } catch {
      /* старая версия Telegram — пробуем следующий способ */
    }
  }

  // Запасной путь внутри Telegram: обычное открытие ссылки.
  if (wa?.openLink) {
    try {
      wa.openLink(shareUrl)
      return true
    } catch {
      /* и этот не сработал */
    }
  }

  // Вне Telegram — системное «поделиться» или новая вкладка.
  if (typeof navigator !== 'undefined' && navigator.share) {
    void navigator.share({ url, text }).catch(() => {})
    return true
  }

  return Boolean(window.open(shareUrl, '_blank'))
}
