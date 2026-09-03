import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from './auth.js'
import {
  acceptConsent,
  claimDailyBonus,
  markProfileReady,
  toPublicUser,
  updateProfile,
} from '../domain/users.js'
import { query } from '../db/client.js'
import { uniqueNickname } from '../domain/nicknames.js'

const AVATAR_IDS = [
  'gamepad', 'dev', 'artist', 'astronaut', 'manager', 'chef', 'cowboy', 'elf',
  'rocker', 'fox', 'panda', 'dragon', 'owl', 'wolf', 'lion',
] as const

const profilePatch = z.object({
  nickname: z.string().trim().min(2).max(24).optional(),
  avatarId: z.enum(AVATAR_IDS).optional(),
  language: z.enum(['ru', 'en']).optional(),
  theme: z.enum(['dark', 'light']).optional(),
  soundEnabled: z.boolean().optional(),
})

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', { preHandler: requireAuth }, async (request) => ({
    user: toPublicUser(request.currentUser!),
  }))

  /**
   * Придумать ник за игрока.
   *
   * Имя из Telegram подставляется само, но светить его хочет не каждый.
   * Выбор был между настоящим именем и придумыванием на месте — а придумывать
   * на входе никто не любит. Ники здесь того же вида, что и у ботов: по одной
   * подписи уже не понять, кто перед тобой.
   */
  app.get('/api/nickname', { preHandler: requireAuth }, async () => ({
    nickname: await uniqueNickname(async (candidate) => {
      const rows = await query<{ id: number }>(
        'SELECT id FROM users WHERE lower(nickname) = lower($1) LIMIT 1',
        [candidate],
      )
      return rows.length > 0
    }),
  }))

  app.patch('/api/me', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = profilePatch.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
    }

    const updated = await updateProfile(request.currentUser!.id, parsed.data)
    return reply.send({ user: toPublicUser(updated!) })
  })

  /** Экран согласия проходится один раз (ЧАСТЬ 2, п.13). */
  app.post('/api/me/consent', { preHandler: requireAuth }, async (request) => {
    const updated = await acceptConsent(request.currentUser!.id)
    return { user: toPublicUser(updated!) }
  })

  /** Знакомство пройдено: игрок выбрал себе имя при первом входе. */
  app.post('/api/me/profile-ready', { preHandler: requireAuth }, async (request) => {
    const updated = await markProfileReady(request.currentUser!.id)
    return { user: toPublicUser(updated!) }
  })

  /** Ежедневный бонус. Повтор в те же сутки вернёт granted: false. */
  app.post('/api/me/daily-bonus', { preHandler: requireAuth }, async (request) => {
    const result = await claimDailyBonus(request.currentUser!.id)
    return result
  })

  /** История операций по медякам. */
  app.get('/api/me/transactions', { preHandler: requireAuth }, async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(request.query ?? {})

    const rows = await query<{
      id: number
      type: string
      amount: string
      balance_after: string
      comment: string | null
      created_at: string
    }>(
      `SELECT id, type, amount::text, balance_after::text, comment, created_at
         FROM transactions
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [request.currentUser!.id, limit],
    )

    return {
      transactions: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balance_after),
        comment: r.comment,
        createdAt: r.created_at,
      })),
    }
  })
}
