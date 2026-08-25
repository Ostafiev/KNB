import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { verifyInitData, InitDataError } from '../telegram/initData.js'
import { issueToken, verifyToken, TokenError } from '../lib/tokens.js'
import { findOrCreate, toPublicUser, findByTelegramId } from '../domain/users.js'
import { queryOne } from '../db/client.js'
import type { UserRow } from '../domain/users.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Игрок, представившийся сессионным токеном. Заполняется requireAuth. */
    currentUser?: UserRow
  }
}

const authBody = z.object({
  initData: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Вход через Telegram.
   *
   * Приложение присылает подписанную initData, сервер проверяет подпись,
   * находит или заводит игрока и выдаёт сессионный токен.
   */
  app.post('/api/auth/telegram', async (request, reply) => {
    const parsed = authBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'нужно поле initData' })
    }

    if (!config.TELEGRAM_BOT_TOKEN) {
      return reply.code(503).send({
        error: 'not_configured',
        message: 'на сервере не задан TELEGRAM_BOT_TOKEN',
      })
    }

    try {
      const verified = verifyInitData(parsed.data.initData, config.TELEGRAM_BOT_TOKEN)

      const { user, isNew } = await findOrCreate(verified.user, {
        startParam: verified.startParam,
        ip: request.ip,
      })

      if (user.banned_at) {
        return reply.code(403).send({ error: 'banned', message: 'аккаунт заблокирован' })
      }

      return reply.send({
        token: issueToken(user.id),
        user: toPublicUser(user, isNew),
      })
    } catch (error) {
      if (error instanceof InitDataError) {
        request.log.warn({ code: error.code }, 'проверка initData не прошла')
        return reply.code(401).send({ error: error.code, message: error.message })
      }
      throw error
    }
  })

  /**
   * Вход для разработки — без Telegram.
   *
   * Нужен, чтобы открывать приложение в обычном браузере, где initData нет.
   * В production-сборке маршрут не регистрируется вовсе.
   */
  if (!config.isProduction) {
    app.post('/api/auth/dev', async (request, reply) => {
      const body = z
        .object({ telegramId: z.number().int().positive().default(999_000_001), name: z.string().optional() })
        .parse(request.body ?? {})

      const { user, isNew } = await findOrCreate(
        {
          id: body.telegramId,
          first_name: body.name ?? 'Тестовый игрок',
          username: `dev_${body.telegramId}`,
          language_code: 'ru',
        },
        { ip: request.ip },
      )

      return reply.send({ token: issueToken(user.id), user: toPublicUser(user, isNew), dev: true })
    })
  }
}

/**
 * Требует сессионный токен и кладёт игрока в request.currentUser.
 * Вешается на защищённые маршруты через preHandler.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized', message: 'нет токена' })
  }

  let userId: number
  try {
    userId = verifyToken(header.slice(7)).sub
  } catch (error) {
    if (error instanceof TokenError) {
      return reply.code(401).send({ error: 'unauthorized', message: error.message })
    }
    throw error
  }

  const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId])
  if (!user) {
    return reply.code(401).send({ error: 'unauthorized', message: 'игрок не найден' })
  }
  if (user.banned_at) {
    return reply.code(403).send({ error: 'banned', message: 'аккаунт заблокирован' })
  }

  request.currentUser = user
}

export { findByTelegramId }
