import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { verifyToken } from '../lib/tokens.js'
import { query } from '../db/client.js'

/**
 * Приём событий поведения.
 *
 * Отвечают на вопрос «сколько»: сколько людей дошло до ставки, сколько
 * досмотрело рекламу, где обрывается путь новичка. Своя таблица, свои данные,
 * ничего не уходит третьим лицам.
 *
 * Авторизация необязательна: первые события приходят до входа.
 */

const eventSchema = z.object({
  name: z.string().min(1).max(64),
  props: z.record(z.unknown()).optional(),
  sessionId: z.string().max(64).optional(),
})

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
})

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/events', async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request' })
    }

    // Токен читаем мягко: если его нет или он плох, просто пишем событие без игрока
    let userId: number | null = null
    const header = request.headers.authorization
    if (header?.startsWith('Bearer ')) {
      try {
        userId = verifyToken(header.slice(7)).sub
      } catch {
        userId = null
      }
    }

    const values: unknown[] = []
    const rows: string[] = []
    for (const event of parsed.data.events) {
      const base = values.length
      values.push(userId, event.name, JSON.stringify(event.props ?? {}), event.sessionId ?? null)
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`)
    }

    await query(
      `INSERT INTO events (user_id, name, props, session_id) VALUES ${rows.join(', ')}`,
      values,
    )

    // Отметка дневной активности — из неё считаются DAU и MAU
    if (userId !== null) {
      await query(
        `INSERT INTO daily_active_users (day, user_id)
         VALUES (CURRENT_DATE, $1)
         ON CONFLICT (day, user_id) DO NOTHING`,
        [userId],
      )
    }

    return reply.code(202).send({ accepted: parsed.data.events.length })
  })
}
