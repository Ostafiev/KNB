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
import { listFriends } from '../domain/friends.js'
import { buildInviteMessage } from '../domain/inviteMessage.js'
import { getInvite, markReady, startIfBothReady, INVITE_TTL_MS } from '../domain/invites.js'
import { savePreparedInlineMessage, TelegramApiError } from '../lib/telegramApi.js'
import { listOpenMatches } from '../domain/matchmaking.js'
import { recordEvent } from '../domain/events.js'
import { announceInvite, announceMatchStart } from '../ws/hub.js'

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
    // Персональный вызов адресован конкретному человеку: для всех
    // остальных это чужая дверь, а не сломанный запрос.
    case 'not_invited':
      return 403
    case 'challenge_expired':
      return 410
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
        // Приглашение по ссылке живёт сутки: друг может открыть его,
        // когда освободится, а не «прямо сейчас или никогда».
        expiresInMs: parsed.data.mode === 'friend' ? INVITE_TTL_MS : null,
      })

      // Хозяин на экране ожидания — значит готов играть прямо сейчас.
      if (match.mode === 'friend') await markReady(match.id, request.currentUser!.id)

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

  /**
   * Открытые бои — те, что ждут соперника прямо сейчас.
   *
   * Это и есть список на экране «Найти бой»: живые игроки со своими
   * условиями, а не выдуманные соперники.
   */
  app.get('/api/matches/open', { preHandler: requireAuth }, async (request) => {
    const filter = z
      .object({
        bet: z.coerce.number().int().min(0).optional(),
        rounds: z.coerce.number().int().min(1).max(9).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query ?? {})

    return { matches: await listOpenMatches(request.currentUser!.id, filter) }
  })

  /** Вход по ссылке-приглашению или в открытый бой из списка. */
  app.post<{ Params: { id: string } }>(
    '/api/matches/:id/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      const matchId = Number(request.params.id)
      if (!Number.isSafeInteger(matchId)) {
        return reply.code(400).send({ error: 'bad_request' })
      }

      try {
        const me = request.currentUser!.id

        /*
         * Приглашение другу — встреча, а не очередь.
         *
         * Гость мог открыть ссылку через час, когда хозяин уже занят другим.
         * Тогда бой не начинаем: отмечаем гостя готовым и говорим ему, что
         * позовём, как только хозяин вернётся. Ждать на экране не нужно никому.
         */
        const invite = await getInvite(matchId)
        if (invite && invite.host.id !== me) {
          /*
           * Личный вызов адресован конкретному человеку. Ссылку могли
           * переслать дальше, но войти по ней вправе только адресат —
           * иначе бой достанется тому, кто оказался быстрее.
           */
          if (invite.invitedId !== null && invite.invitedId !== me) {
            throw new MatchError('not_invited', 'этот вызов адресован другому игроку')
          }
          // Просроченное приглашение — закрытая дверь, а не очередь.
          if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
            throw new MatchError('challenge_expired', 'приглашение истекло')
          }
          // Второй игрок уже есть — свободных мест нет.
          if (invite.guest !== null && invite.guest.id !== me) {
            throw new MatchError('match_full', 'в матче уже есть второй игрок')
          }

          await query(
            `UPDATE matches SET player2_id = $2 WHERE id = $1 AND player2_id IS NULL`,
            [matchId, me],
          )
          const ready = await markReady(matchId, me)

          if (ready?.bothReady) {
            const started = await startIfBothReady(matchId)
            if (started) {
              await announceMatchStart(started.match, started.round)
              await recordEvent(me, 'match_joined', { matchId })
              return reply.send({ match: await buildMatchView(started.match, me) })
            }
          }

          await recordEvent(me, 'invite_accepted', { matchId })

          // Хозяину — окно «друг принял вызов», если он сейчас в приложении.
          const updated = await getInvite(matchId)
          if (updated) announceInvite([updated.host.id], updated)
          return reply.send({ waiting: true, invite: updated })
        }

        const started = await startMatch(matchId, me)
        await announceMatchStart(started.match, started.round)
        await recordEvent(me, 'match_joined', { matchId })

        return reply.send({
          match: await buildMatchView(started.match, me),
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

  /**
   * Готовит приглашение к отправке в Telegram.
   *
   * Telegram придерживает сообщение у себя и отдаёт короткий идентификатор.
   * Приложение показывает по нему родное окно выбора чата — то самое, где
   * человек выбирает друга из своего списка контактов. Само сообщение никуда
   * не уходит, пока получателя не выбрали.
   */
  app.post<{ Params: { id: string } }>(
    '/api/matches/:id/share',
    { preHandler: requireAuth },
    async (request, reply) => {
      const matchId = Number(request.params.id)
      if (!Number.isSafeInteger(matchId)) {
        return reply.code(400).send({ error: 'bad_request' })
      }

      const match = await getMatch(matchId)
      if (!match) return reply.code(404).send({ error: 'match_not_found' })

      const me = request.currentUser!
      if (match.player1_id !== me.id) {
        return reply.code(403).send({ error: 'not_a_player' })
      }

      const message = buildInviteMessage(match, me.language === 'en' ? 'en' : 'ru')

      try {
        const prepared = await savePreparedInlineMessage({
          telegramUserId: Number(me.telegram_id),
          ...message,
        })
        return reply.send({
          preparedMessageId: prepared.id,
          expiresAt: prepared.expiration_date * 1000,
          text: message.text,
          url: message.buttonUrl,
        })
      } catch (error) {
        if (error instanceof TelegramApiError) {
          /*
           * Не беда: приложение покажет ссылку и обычное «поделиться».
           * Отдаём текст и адрес, чтобы запасной путь выглядел так же.
           */
          request.log.warn({ code: error.code, matchId }, 'не удалось подготовить приглашение')
          return reply.code(200).send({
            preparedMessageId: null,
            reason: error.code,
            text: message.text,
            url: message.buttonUrl,
          })
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

  /**
   * Друзья: кого пригласил, кто пригласил, с кем играл.
   *
   * Telegram список контактов не отдаёт никому, поэтому здесь только те люди,
   * с которыми у игрока есть общая история в самой игре.
   */
  app.get('/api/me/friends', { preHandler: requireAuth }, async (request) => {
    return { friends: await listFriends(request.currentUser!.id) }
  })
}
