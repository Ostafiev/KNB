import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { query, queryOne } from '../db/client.js'

/**
 * Вход в админку через Telegram.
 *
 * Пароля нет намеренно: панель двигает балансы игроков, и подобранный пароль
 * здесь означает чужие деньги. Telegram уже подтвердил личность, а нам
 * остаётся проверить подпись и убедиться, что этот человек в списке админов.
 *
 * Подпись виджета входа считается иначе, чем подпись Mini App: ключ здесь —
 * SHA-256 от токена бота, а не HMAC от строки WebAppData. Перепутать легко,
 * поэтому проверка живёт отдельной функцией.
 */

export interface TelegramLoginData {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export class LoginError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'LoginError'
  }
}

/** Подпись живёт сутки: старую ссылку входа переиспользовать нельзя. */
const LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60

export function verifyLoginWidget(raw: Record<string, string>, botToken: string): TelegramLoginData {
  const { hash, ...fields } = raw
  if (!hash) throw new LoginError('no_hash', 'в ответе Telegram нет подписи')

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')

  const secret = createHash('sha256').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  const given = Buffer.from(hash)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new LoginError('bad_signature', 'подпись Telegram не совпала')
  }

  const authDate = Number(fields.auth_date)
  if (!Number.isFinite(authDate)) throw new LoginError('bad_auth_date', 'нет времени входа')
  if (Math.floor(Date.now() / 1000) - authDate > LOGIN_MAX_AGE_SECONDS) {
    throw new LoginError('expired', 'ссылка входа устарела, попробуйте ещё раз')
  }

  const id = Number(fields.id)
  if (!Number.isSafeInteger(id)) throw new LoginError('bad_id', 'некорректный идентификатор')

  return { ...fields, id, auth_date: authDate, hash } as unknown as TelegramLoginData
}

// ─── Список админов ──────────────────────────────────────────────────────────

export interface AdminRow {
  id: number
  login: string
  display_name: string
  telegram_id: number | null
  disabled_at: string | null
}

/**
 * Заводит админов из переменной окружения.
 *
 * Первый администратор не может появиться через саму панель — это круг.
 * Поэтому список Telegram id задаётся при развёртывании и сверяется при
 * каждом старте: добавил id в настройках Render, перезапустил — готово.
 */
export async function ensureAdminsFromEnv(): Promise<number> {
  if (config.adminTelegramIds.length === 0) return 0

  let created = 0
  for (const telegramId of config.adminTelegramIds) {
    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM admins WHERE telegram_id = $1',
      [telegramId],
    )
    if (existing) continue

    await query(
      `INSERT INTO admins (login, display_name, telegram_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (login) DO UPDATE SET telegram_id = EXCLUDED.telegram_id`,
      [`tg_${telegramId}`, `Telegram ${telegramId}`, telegramId],
    )
    created += 1
  }
  return created
}

export async function findAdminByTelegramId(telegramId: number): Promise<AdminRow | null> {
  return queryOne<AdminRow>(
    'SELECT id, login, display_name, telegram_id, disabled_at FROM admins WHERE telegram_id = $1',
    [telegramId],
  )
}

// ─── Сессия ──────────────────────────────────────────────────────────────────

const COOKIE_NAME = 'knb_admin'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

interface SessionPayload {
  sub: number
  sid: string
  exp: number
}

function sign(body: string): string {
  return createHmac('sha256', config.ADMIN_SESSION_SECRET).update(body).digest('base64url')
}

function issueSession(adminId: number): string {
  const payload: SessionPayload = {
    sub: adminId,
    sid: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

function readSession(token: string): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [body, signature] = parts
  const expected = sign(body)
  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.sub !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function setSessionCookie(reply: FastifyReply, adminId: number): void {
  const parts = [
    `${COOKIE_NAME}=${issueSession(adminId)}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (config.isProduction) parts.push('Secure')
  void reply.header('set-cookie', parts.join('; '))
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.header('set-cookie', `${COOKIE_NAME}=; Path=/admin; HttpOnly; Max-Age=0`)
}

function cookieValue(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie
  if (!header) return null
  for (const chunk of header.split(';')) {
    const [key, ...rest] = chunk.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Администратор, вошедший в панель. Заполняется requireAdmin. */
    currentAdmin?: AdminRow
  }
}

/** Пускает в панель только вошедшего администратора. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = cookieValue(request, COOKIE_NAME)
  const session = token ? readSession(token) : null

  if (!session) {
    return reply.redirect('/admin/login')
  }

  const admin = await queryOne<AdminRow>(
    'SELECT id, login, display_name, telegram_id, disabled_at FROM admins WHERE id = $1',
    [session.sub],
  )

  if (!admin || admin.disabled_at) {
    clearSessionCookie(reply)
    return reply.redirect('/admin/login')
  }

  request.currentAdmin = admin
}

// ─── Журнал действий ─────────────────────────────────────────────────────────

/**
 * Пишет действие администратора. Хранит «было» и «стало», чтобы ошибку
 * можно было разобрать и откатить руками.
 */
export async function audit(
  adminId: number,
  action: string,
  target: { type: string; id: number | null },
  change: { before?: unknown; after?: unknown; comment?: string; ip?: string } = {},
): Promise<void> {
  await query(
    `INSERT INTO admin_audit (admin_id, action, target_type, target_id, before, after, comment, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      adminId,
      action,
      target.type,
      target.id,
      change.before === undefined ? null : JSON.stringify(change.before),
      change.after === undefined ? null : JSON.stringify(change.after),
      change.comment ?? null,
      change.ip ?? null,
    ],
  )
}
