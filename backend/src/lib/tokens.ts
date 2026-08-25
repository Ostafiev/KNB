import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { config } from '../config.js'

/**
 * Сессионные токены.
 *
 * Формат: base64url(payload).base64url(подпись). Подпись — HMAC-SHA256 от
 * тела токена секретом сервера. Подделать тело нельзя, не зная секрета.
 *
 * Зачем свой токен, если initData и так подписана: подпись Telegram стареет,
 * а WebSocket-соединению нужен способ представиться один раз при подключении.
 */

export interface SessionPayload {
  /** Идентификатор игрока в нашей базе. */
  sub: number
  /** Идентификатор сессии — пригодится, чтобы отзывать доступ. */
  sid: string
  /** Время выпуска и истечения, в секундах. */
  iat: number
  exp: number
}

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(body: string): string {
  return createHmac('sha256', config.AUTH_TOKEN_SECRET).update(body).digest('base64url')
}

export function issueToken(userId: number, ttlSeconds = TOKEN_TTL_SECONDS): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    sub: userId,
    sid: randomUUID(),
    iat: now,
    exp: now + ttlSeconds,
  }
  const body = base64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export class TokenError extends Error {}

export function verifyToken(token: string): SessionPayload {
  const parts = token.split('.')
  if (parts.length !== 2) throw new TokenError('неверный формат токена')

  const [body, signature] = parts
  const expected = sign(body)

  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new TokenError('подпись токена не совпала')
  }

  let payload: SessionPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
  } catch {
    throw new TokenError('тело токена не разбирается')
  }

  if (typeof payload.sub !== 'number' || typeof payload.exp !== 'number') {
    throw new TokenError('в токене нет обязательных полей')
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new TokenError('токен истёк')
  }

  return payload
}
