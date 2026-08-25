import type { FastifyInstance } from 'fastify'
import { pool } from '../db/client.js'
import { redis } from '../lib/redis.js'

/**
 * Проверка живости. Отвечает 200, только если и база, и Redis отзываются —
 * иначе балансировщик считал бы сервер здоровым при мёртвой базе.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {}

    try {
      await pool.query('SELECT 1')
      checks.postgres = { ok: true }
    } catch (error) {
      checks.postgres = { ok: false, error: (error as Error).message }
    }

    try {
      await redis.ping()
      checks.redis = { ok: true }
    } catch (error) {
      checks.redis = { ok: false, error: (error as Error).message }
    }

    const ok = Object.values(checks).every((c) => c.ok)
    return reply.code(ok ? 200 : 503).send({ ok, checks, uptime: Math.round(process.uptime()) })
  })

  // Готовность к приёму трафика: применены ли миграции
  app.get('/health/ready', async (_request, reply) => {
    try {
      const { rows } = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      )
      return reply.send({ ok: true, migrations: Number(rows[0].count) })
    } catch {
      return reply.code(503).send({ ok: false, error: 'миграции не применены' })
    }
  })
}
