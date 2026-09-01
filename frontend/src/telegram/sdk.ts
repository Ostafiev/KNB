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
  isVersionAtLeast?: (version: string) => boolean
  shareMessage?: (preparedMessageId: string, callback?: (sent: boolean) => void) => void
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
 * Родное окно Telegram «кому отправить».
 *
 * Это то самое окно со списком чатов. Сообщение к этому моменту уже готово
 * на стороне Telegram — приложение лишь называет его номер. Пока получателя
 * не выбрали, никуда ничего не уходит.
 *
 * Работает с Telegram 8.0 и новее; в старых версиях метода просто нет,
 * и тогда остаётся прежний путь через ссылку.
 */
/** Что приложение может рассказать о себе — для разбора жалоб. */
export function telegramDiagnostics(): string {
  const wa = getWebApp()
  if (!wa) return 'вне Telegram'
  const parts = [`Telegram ${wa.version ?? '?'}`]
  parts.push(wa.shareMessage ? 'выбор чата: есть' : 'выбор чата: нет')
  parts.push(wa.openTelegramLink ? 'ссылки: есть' : 'ссылки: нет')
  return parts.join(' · ')
}

export function sharePreparedMessage(
  preparedMessageId: string,
  onResult?: (sent: boolean) => void,
): boolean {
  const wa = getWebApp()
  if (!wa?.shareMessage) return false
  try {
    wa.shareMessage(preparedMessageId, onResult)
    return true
  } catch {
    return false
  }
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
