import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { z } from 'zod'
import { query } from '../db/client.js'
import { verifyToken, TokenError } from '../lib/tokens.js'
import { queryOne } from '../db/client.js'
import {
  abandonMatch,
  getMatch,
  isChoice,
  recordMove,
  MatchError,
  type MatchRow,
  type RoundRow,
} from '../domain/match.js'
import { dequeue, enqueue, setLivenessCheck } from '../domain/matchmaking.js'
import { recordEvent } from '../domain/events.js'
import {
  announceMatchStart,
  announceMatchFinished,
  announceOpponentMoved,
  announceOutcome,
  armRoundTimer,
  scheduleNextRound,
  isOnline,
  registerConnection,
  sendMatchState,
  sendToUser,
} from './hub.js'

/**
 * Канал реального времени.
 *
 * Через него идёт всё, что должно случаться сразу: подбор соперника, ходы,
 * результаты раундов. Обычные запросы для этого не годятся — соперник ходит
 * тогда, когда ходит, и опрашивать сервер каждую секунду было бы расточительно.
 *
 * Токен передаётся в адресе, а не в заголовке: браузерный WebSocket не умеет
 * ставить свои заголовки. Токен подписан и живёт ограниченное время.
 */

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('queue'), bet: z.number().int(), rounds: z.number().int() }),
  z.object({ type: z.literal('queue_cancel') }),
  z.object({ type: z.literal('move'), matchId: z.number().int(), choice: z.string() }),
  z.object({ type: z.literal('leave'), matchId: z.number().int() }),
  z.object({ type: z.literal('resume'), matchId: z.number().int() }),
])

export async function socketRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 4096 } })

  setLivenessCheck(isOnline)

  app.get('/ws', { websocket: true }, (socket, request) => {
    const token = (request.query as { token?: string }).token

    let userId: number
    try {
      if (!token) throw new TokenError('нет токена')
      userId = verifyToken(token).sub
    } catch {
      socket.send(JSON.stringify({ type: 'error', code: 'unauthorized' }))
      socket.close()
      return
    }

    const unregister = registerConnection(userId, (payload) => socket.send(payload))

    void queryOne('UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING id', [userId])
    socket.send(JSON.stringify({ type: 'hello', userId }))

    socket.on('message', (raw: Buffer) => {
      void handleMessage(app, userId, raw.toString())
    })

    socket.on('close', () => {
      unregister()
      // Из очереди выходим сразу: держать в подборе того, кто закрыл
      // приложение, значит подсовывать сопернику матч без соперника.
      void dequeue(userId)
    })

    socket.on('error', () => {
      unregister()
      void dequeue(userId)
    })
  })
}

async function handleMessage(app: FastifyInstance, userId: number, raw: string): Promise<void> {
  let parsed: z.infer<typeof clientMessage>
  try {
    parsed = clientMessage.parse(JSON.parse(raw))
  } catch {
    sendToUser(userId, { type: 'error', code: 'bad_message' })
    return
  }

  try {
    switch (parsed.type) {
      case 'ping':
        sendToUser(userId, { type: 'pong' })
        return

      case 'queue': {
        const result = await enqueue(userId, parsed.bet, parsed.rounds)
        if (result.matched && result.match && result.round) {
          await announceMatchStart(result.match, result.round)
          await recordEvent(userId, 'match_started', {
            matchId: result.match.id,
            mode: 'random',
            bet: result.match.bet_amount,
          })
        } else {
          sendToUser(userId, { type: 'queue_joined', ...result.waiting })
        }
        return
      }

      case 'queue_cancel':
        await dequeue(userId)
        sendToUser(userId, { type: 'queue_left' })
        return

      case 'move': {
        if (!isChoice(parsed.choice)) {
          sendToUser(userId, { type: 'error', code: 'bad_choice' })
          return
        }

        const outcome = await recordMove(parsed.matchId, userId, parsed.choice)

        if (outcome.suspiciouslyFast) {
          app.log.warn(
            { userId, matchId: parsed.matchId },
            'ход быстрее физически возможного времени реакции',
          )
          await recordEvent(userId, 'suspicious_fast_move', { matchId: parsed.matchId })
        }

        sendToUser(userId, {
          type: 'move_accepted',
          matchId: parsed.matchId,
          roundNumber: outcome.round.round_number,
          choice: parsed.choice,
        })

        if (!outcome.resolved) {
          announceOpponentMoved(outcome.match, userId, outcome.round.round_number)
          return
        }

        await announceOutcome(outcome)
        return
      }

      case 'leave': {
        const result = await abandonMatch(parsed.matchId, userId)
        if (result) {
          await announceMatchFinished(result.match.id)
          await recordEvent(userId, 'match_left', { matchId: parsed.matchId })
        }
        return
      }

      case 'resume': {
        const match = await getMatch(parsed.matchId)
        if (!match) {
          sendToUser(userId, { type: 'error', code: 'match_not_found' })
          return
        }
        await sendMatchState(match.id, userId)
        return
      }
    }
  } catch (error) {
    if (error instanceof MatchError) {
      sendToUser(userId, { type: 'error', code: error.code, message: error.message })
      return
    }
    app.log.error({ err: error, userId }, 'ошибка обработки сообщения')
    sendToUser(userId, { type: 'error', code: 'internal' })
  }
}

/**
 * После перезапуска сервера часы раундов пропадают вместе с процессом.
 * Поднимаем их заново, иначе матч, начатый до выкатки новой версии,
 * завис бы навсегда.
 */
export async function recoverActiveMatches(): Promise<number> {
  const rows = await query<MatchRow & RoundRow & { round_id: number }>(
    `SELECT m.*, r.id AS round_id, r.round_number, r.started_at AS round_started_at
       FROM matches m
       JOIN rounds r ON r.match_id = m.id AND r.resolved_at IS NULL
      WHERE m.status = 'active'`,
  )

  for (const row of rows) {
    const match = row as unknown as MatchRow
    const round = {
      id: row.round_id,
      round_number: row.round_number,
      started_at: (row as unknown as { round_started_at: string }).round_started_at,
    } as RoundRow
    await armRoundTimer(match, round)
  }

  /*
   * Перезапуск мог прийтись на паузу между раундами: матч идёт, а открытого
   * раунда нет. Такие матчи надо продолжить, иначе они зависнут навсегда.
   */
  const paused = await query<{ id: number }>(
    `SELECT m.id
       FROM matches m
      WHERE m.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM rounds r WHERE r.match_id = m.id AND r.resolved_at IS NULL
        )`,
  )
  for (const row of paused) scheduleNextRound(row.id, 500)

  return rows.length + paused.length
}
