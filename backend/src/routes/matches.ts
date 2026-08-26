import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from './auth.js'
import { query } from '../db/client.js'
import {
  abandonMatch,
  createMatch,
  getMatch,
  startMatch,
  MatchError,
  type MatchRow,
} from '../domain/match.js'
import { buildMatchView } from '../domain/matchView.js'
import { getReferralSummary } from '../domain/referrals.js'
import { recordEvent } from '../domain/events.js'
import { announceMatchStart } from '../ws/hub.js'

/**
 * Обычные запросы вокруг матча: создать приглашение другу, войти по ссылке,
 * посмотреть матч и историю. Всё, что происходит внутри боя, идёт по WebSocket.
 */

const createBody = z.object({
  mode: z.enum(['random', 'friend']).default('friend'),
  bet: z.number().int().min(0),
  rounds: z.number().int().min(1).max(9),
  condition: z.string().trim().max(200).optional(),
  rematchOf: z.number().int().positive().optional(),
})

function matchErrorStatus(code: string): number {
  switch (code) {
    case 'match_not_found':
      return 404
    case 'not_a_player':
    case 'banned':
      return 403
    case 'insufficient_funds':
      return 402
    case 'match_full':
    case 'match_not_joinable':
      return 409
    default:
      return 400
  }
}

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  /** Приглашение другу: матч ждёт второго игрока по ссылке. */
  app.post('/api/matches', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
    }

    try {
      const match = await createMatch({
        mode: parsed.data.mode,
        player1Id: request.currentUser!.id,
        bet: parsed.data.bet,
        rounds: parsed.data.rounds,
        condition: parsed.data.condition ?? null,
        rematchOf: parsed.data.rematchOf ?? null,
      })

      await recordEvent(request.currentUser!.id, 'match_created', {
        matchId: match.id,
        mode: match.mode,
        bet: match.bet_amount,
        rounds: match.rounds_total,
      })

      return reply.send({
        match: await buildMatchView(match, request.currentUser!.id),
        // Ссылка собирается в приложении: там известен юзернейм бота.
        startParam: `match_${match.id}`,
      })
    } catch (error) {
      if (error instanceof MatchError) {
        return reply
          .code(matchErrorStatus(error.code))
          .send({ error: error.code, message: error.message })
      }
      throw error
    }
  })

  /** Вход по ссылке-приглашению. */
  app.post<{ Params: { id: string } }>(
    '/api/matches/:id/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      const matchId = Number(request.params.id)
      if (!Number.isSafeInteger(matchId)) {
        return reply.code(400).send({ error: 'bad_request' })
      }

      try {
        const started = await startMatch(matchId, request.currentUser!.id)
        await announceMatchStart(started.match, started.round)
        await recordEvent(request.currentUser!.id, 'match_joined', { matchId })

        return reply.send({
          match: await buildMatchView(started.match, request.currentUser!.id),
        })
      } catch (error) {
        if (error instanceof MatchError) {
          return reply
            .code(matchErrorStatus(error.code))
            .send({ error: error.code, message: error.message })
        }
        throw error
      }
    },
  )

  /** Состояние матча глазами запрашивающего. */
  app.get<{ Params: { id: string } }>(
    '/api/matches/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const match = await getMatch(Number(request.params.id))
      if (!match) return reply.code(404).send({ error: 'match_not_found' })

      const me = request.currentUser!.id
      if (match.player1_id !== me && match.player2_id !== me) {
        // Приглашённый ещё не вошёл — ему нужно видеть условия до согласия.
        if (match.status !== 'pending') {
          return reply.code(403).send({ error: 'not_a_player' })
        }
        const host = await query<{ nickname: string; avatar_id: string; rating: number }>(
          'SELECT nickname, avatar_id, rating FROM users WHERE id = $1',
          [match.player1_id],
        )
        return reply.send({
          invite: {
            matchId: match.id,
            bet: match.bet_amount,
            rounds: match.rounds_total,
            condition: match.condition,
            host: host[0]
              ? { nickname: host[0].nickname, avatarId: host[0].avatar_id, rating: host[0].rating }
              : null,
          },
        })
      }

      return reply.send({ match: await buildMatchView(match, me) })
    },
  )

  /** Отмена приглашения или выход из матча. */
  app.post<{ Params: { id: string } }>(
    '/api/matches/:id/leave',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const result = await abandonMatch(Number(request.params.id), request.currentUser!.id)
        if (!result) return reply.send({ ok: true })
        return reply.send({ match: await buildMatchView(result.match, request.currentUser!.id) })
      } catch (error) {
        if (error instanceof MatchError) {
          return reply
            .code(matchErrorStatus(error.code))
            .send({ error: error.code, message: error.message })
        }
        throw error
      }
    },
  )

  /** Последние игры для главного экрана. */
  app.get('/api/me/matches', { preHandler: requireAuth }, async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
      .parse(request.query ?? {})

    const me = request.currentUser!.id
    const rows = await query<MatchRow>(
      `SELECT * FROM matches
        WHERE status = 'finished' AND (player1_id = $1 OR player2_id = $1)
        ORDER BY finished_at DESC
        LIMIT $2`,
      [me, limit],
    )

    const matches = await Promise.all(rows.map((row) => buildMatchView(row, me)))
    return { matches }
  })

  /** Сводка по приглашённым. */
  app.get('/api/me/referrals', { preHandler: requireAuth }, async (request) => {
    return getReferralSummary(request.currentUser!.id)
  })
}
