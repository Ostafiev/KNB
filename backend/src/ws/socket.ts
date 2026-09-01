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
import { cancelOpen, enqueue, setLivenessCheck } from '../domain/matchmaking.js'
import {
  clearReady,
  invitesNeedingAttention,
  markReady,
  releaseAll,
  snooze,
  startIfBothReady,
  expireStaleInvites,
} from '../domain/invites.js'
import {
  acceptChallenge,
  cancelChallenge,
  declineChallenge,
  dropOutgoingOf,
  expireStale,
  listChallenges,
  sendChallenge,
} from '../domain/challenges.js'
import { isBotId, startBotRuntime } from './botRuntime.js'
import { recordEvent } from '../domain/events.js'
import {
  announceInvite,
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
  // Вызов друга на бой
  z.object({
    type: z.literal('challenge'),
    toUserId: z.number().int(),
    bet: z.number().int(),
    rounds: z.number().int(),
    condition: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('challenge_accept'), matchId: z.number().int() }),
  z.object({ type: z.literal('challenge_decline'), matchId: z.number().int() }),
  z.object({ type: z.literal('challenge_cancel'), matchId: z.number().int() }),
  z.object({ type: z.literal('challenges') }),
  // Приглашение другу: «я готов», «сейчас неудобно», «ухожу с ожидания»
  z.object({ type: z.literal('invite_ready'), matchId: z.number().int() }),
  z.object({ type: z.literal('invite_later'), matchId: z.number().int() }),
  z.object({ type: z.literal('invite_release'), matchId: z.number().int() }),
  z.object({ type: z.literal('invites') }),
])

export async function socketRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 4096 } })

  /*
   * Бот «на связи» всегда: у него нет соединения, но его открытый бой должен
   * быть виден в списке, иначе никто не сможет к нему присоединиться.
   */
  setLivenessCheck((userId) => isOnline(userId) || isBotId(userId))

  await startBotRuntime(app)
  startChallengeSweeper(app)

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

    /*
     * Человек вернулся в приложение. Если его ждёт приглашение — покажем
     * прямо сейчас: ради этого он и не сидел на экране ожидания.
     */
    void sendPendingInvites(userId)

    /*
     * Сообщения одного игрока обрабатываются строго по очереди.
     *
     * Иначе шесть вызовов, отправленных разом, проверяли бы «сколько вызовов
     * уже отправлено» одновременно — и каждый видел бы ноль. Так обходится
     * любое ограничение, считающее прошлые действия: очередь здесь не роскошь,
     * а условие того, что счётчики вообще работают.
     */
    let chain: Promise<void> = Promise.resolve()

    socket.on('message', (raw: Buffer) => {
      const text = raw.toString()
      chain = chain.then(() =>
        handleMessage(app, userId, text).catch((error: unknown) => {
          app.log.error({ err: error, userId }, 'сообщение не обработано')
        }),
      )
    })

    const onGone = (): void => {
      unregister()
      // Из очереди выходим сразу: держать в подборе того, кто закрыл
      // приложение, значит подсовывать сопернику матч без соперника.
      void cancelOpen(userId)
      // То же и с вызовами: принять приглашение от того, кто вышел, значит
      // остаться в бою одному.
      // Ушёл — значит больше не ждёт. Приглашение при этом остаётся жить.
      void releaseAll(userId)
      void dropOutgoingOf(userId).then((gone) => {
        for (const item of gone) {
          sendToUser(item.to, { type: 'challenge_cancelled', matchId: item.matchId })
        }
      })
    }

    socket.on('close', onGone)
    socket.on('error', onGone)
  })
}

/**
 * Гасит вызовы, на которые не ответили, и говорит об этом обеим сторонам.
 *
 * Сроком заведует сервер, а не таймер в приложении: закрытая вкладка не
 * должна оставлять другу вечно висящее окно «тебя зовут».
 */
const SWEEP_MS = 5_000

function startChallengeSweeper(app: FastifyInstance): void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        for (const gone of await expireStale()) {
          sendToUser(gone.from, { type: 'challenge_expired', matchId: gone.matchId })
          sendToUser(gone.to, { type: 'challenge_expired', matchId: gone.matchId })
        }
        // Заодно закрываем приглашения, которые провисели сутки.
        await expireStaleInvites()
      } catch (error) {
        app.log.error({ err: error }, 'не удалось погасить просроченные вызовы')
      }
    })()
  }, SWEEP_MS)
  timer.unref?.()
}

/**
 * Показывает приглашения, которые ждут именно этого человека.
 *
 * Хозяину — «друг принял вызов, играем?», гостю — «хозяин вернулся».
 * Если оба уже готовы и оба на связи, бой начинается сам.
 */
async function sendPendingInvites(userId: number): Promise<void> {
  try {
    for (const invite of await invitesNeedingAttention(userId)) {
      const started = await startIfBothReady(invite.matchId)
      if (started) {
        await announceMatchStart(started.match, started.round)
        continue
      }
      announceInvite([userId], invite)
    }
  } catch (error) {
    console.error('не удалось показать приглашения', error)
  }
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
        await cancelOpen(userId)
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

      // ─── Вызов друга ───────────────────────────────────────────────────────

      case 'challenge': {
        const challenge = await sendChallenge({
          fromId: userId,
          toId: parsed.toUserId,
          bet: parsed.bet,
          rounds: parsed.rounds,
          condition: parsed.condition?.trim() || null,
        })
        sendToUser(userId, { type: 'challenge_sent', challenge })
        sendToUser(challenge.to.id, { type: 'challenge_received', challenge })
        await recordEvent(userId, 'challenge_sent', {
          matchId: challenge.matchId,
          toUserId: challenge.to.id,
          bet: challenge.bet,
        })
        return
      }

      case 'challenge_accept': {
        const started = await acceptChallenge(parsed.matchId, userId)
        await announceMatchStart(started.match, started.round)
        await recordEvent(userId, 'match_started', {
          matchId: started.match.id,
          mode: 'friend',
          bet: started.match.bet_amount,
          fromChallenge: true,
        })
        return
      }

      case 'challenge_decline': {
        const declined = await declineChallenge(parsed.matchId, userId)
        if (!declined) return
        sendToUser(declined.from.id, { type: 'challenge_declined', matchId: declined.matchId })
        sendToUser(userId, { type: 'challenge_closed', matchId: declined.matchId })
        return
      }

      case 'challenge_cancel': {
        const cancelled = await cancelChallenge(parsed.matchId, userId)
        if (!cancelled) return
        sendToUser(cancelled.to.id, { type: 'challenge_cancelled', matchId: cancelled.matchId })
        sendToUser(userId, { type: 'challenge_closed', matchId: cancelled.matchId })
        return
      }

      case 'challenges': {
        sendToUser(userId, { type: 'challenges', ...(await listChallenges(userId)) })
        return
      }

      // ─── Приглашение другу ─────────────────────────────────────────────────

      case 'invites': {
        await sendPendingInvites(userId)
        return
      }

      case 'invite_ready': {
        const ready = await markReady(parsed.matchId, userId)
        if (!ready) {
          sendToUser(userId, { type: 'error', code: 'invite_not_found' })
          return
        }

        if (ready.bothReady) {
          const started = await startIfBothReady(parsed.matchId)
          if (started) {
            await announceMatchStart(started.match, started.round)
            return
          }
        }

        /*
         * Второго нет на связи. Никто никого не караулит: обоим сообщаем
         * положение дел, и человек спокойно уходит — позовут, когда сойдутся.
         */
        const invite = ready.invite
        const others = [invite.host.id, invite.guest?.id].filter(
          (id): id is number => typeof id === 'number' && id !== userId,
        )
        announceInvite([userId, ...others], invite)
        return
      }

      case 'invite_later': {
        const invite = await snooze(parsed.matchId, userId)
        if (invite) announceInvite([userId], invite)
        return
      }

      case 'invite_release': {
        await clearReady(parsed.matchId, userId)
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
