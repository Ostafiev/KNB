import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Проверка подписи initData из Telegram Mini App.
 *
 * Telegram отдаёт приложению строку вида
 *   user=%7B...%7D&auth_date=1699999999&hash=abc...
 * подписанную ключом, производным от токена бота. Проверка — единственный
 * способ убедиться, что пользователь тот, за кого себя выдаёт: без неё любой
 * может прислать чужой telegram_id и забрать чужой баланс.
 *
 * Алгоритм по документации Telegram:
 *   secret     = HMAC_SHA256(bot_token, key="WebAppData")
 *   check_hash = HMAC_SHA256(data_check_string, key=secret)
 * где data_check_string — все поля кроме hash, отсортированные по имени
 * и склеенные через перевод строки.
 */

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
  is_premium?: boolean
}

export interface VerifiedInitData {
  user: TelegramUser
  authDate: Date
  startParam?: string
  queryId?: string
}

export class InitDataError extends Error {
  constructor(
    message: string,
    readonly code: 'malformed' | 'bad_signature' | 'expired' | 'no_user',
  ) {
    super(message)
    this.name = 'InitDataError'
  }
}

/** Сколько времени подпись считается свежей. Telegram обновляет её при каждом открытии. */
const MAX_AGE_SECONDS = 24 * 60 * 60

export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = MAX_AGE_SECONDS,
): VerifiedInitData {
  if (!botToken) {
    throw new InitDataError('TELEGRAM_BOT_TOKEN не задан на сервере', 'malformed')
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) throw new InitDataError('в initData нет поля hash', 'malformed')

  // Строка проверки: все поля кроме hash, отсортированы по имени
  const pairs: string[] = []
  for (const [key, value] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (key === 'hash') continue
    pairs.push(`${key}=${value}`)
  }
  const dataCheckString = pairs.join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  // Сравнение постоянного времени: обычное сравнение строк утекает информацию
  // о том, сколько символов совпало, и позволяет подобрать подпись побайтово.
  const given = Buffer.from(hash, 'hex')
  const want = Buffer.from(expected, 'hex')
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new InitDataError('подпись initData не совпала', 'bad_signature')
  }

  const authDateRaw = params.get('auth_date')
  if (!authDateRaw) throw new InitDataError('в initData нет auth_date', 'malformed')
  const authDate = new Date(Number(authDateRaw) * 1000)

  const ageSeconds = (Date.now() - authDate.getTime()) / 1000
  if (ageSeconds > maxAgeSeconds) {
    throw new InitDataError('подпись initData устарела', 'expired')
  }

  const userRaw = params.get('user')
  if (!userRaw) throw new InitDataError('в initData нет данных пользователя', 'no_user')

  let user: TelegramUser
  try {
    user = JSON.parse(userRaw) as TelegramUser
  } catch {
    throw new InitDataError('данные пользователя не разбираются', 'malformed')
  }
  if (typeof user.id !== 'number') {
    throw new InitDataError('в данных пользователя нет id', 'no_user')
  }

  return {
    user,
    authDate,
    startParam: params.get('start_param') ?? undefined,
    queryId: params.get('query_id') ?? undefined,
  }
}

/**
 * Собирает подписанную initData — нужна только для тестов, чтобы проверять
 * авторизацию без настоящего бота.
 */
export function buildInitData(
  botToken: string,
  user: TelegramUser,
  extra: { authDate?: Date; startParam?: string } = {},
): string {
  const params = new URLSearchParams()
  params.set('user', JSON.stringify(user))
  params.set('auth_date', String(Math.floor((extra.authDate ?? new Date()).getTime() / 1000)))
  if (extra.startParam) params.set('start_param', extra.startParam)

  const pairs = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', createHmac('sha256', secret).update(pairs).digest('hex'))
  return params.toString()
}
