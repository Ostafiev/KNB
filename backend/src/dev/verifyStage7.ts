import WebSocket from 'ws'
import { buildServer } from '../server.js'
import { pool, query, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'
import { invalidateEconomyCache } from '../domain/appConfig.js'
import { CHALLENGE_TTL_MS } from '../domain/challenges.js'

/**
 * Проверка этапа 7: друзья и вызов на бой.
 *
 * Проверяется ровно то, что обещано игроку:
 *
 * 1. Список друзей не выдуман. В нём только люди, с которыми есть общая
 *    история: пришли по ссылке, пригласили сами, играли вместе. Боты и
 *    посторонние в список не попадают.
 * 2. Вызов доходит мгновенно и ничего не стоит, пока на него не ответили:
 *    ни отказ, ни истечение срока не трогают баланс.
 * 3. Чужой вызов нельзя перехватить, а звать незнакомых людей нельзя вовсе.
 *
 * Запуск: npm run verify:stage7
 */

let passed = 0
let failed = 0

function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}`)
    if (detail !== undefined) console.log('    ', JSON.stringify(detail).slice(0, 400))
  }
}

function section(title: string): void {
  console.log(`\n${title}`)
}

interface ServerEvent {
  type: string
  [key: string]: unknown
}

class Client {
  private socket!: WebSocket
  private buffer: ServerEvent[] = []
  private waiters: { match: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = []

  constructor(
    readonly name: string,
    readonly userId: number,
    readonly token: string,
  ) {}

  async connect(baseUrl: string): Promise<void> {
    this.socket = new WebSocket(`${baseUrl}/ws?token=${encodeURIComponent(this.token)}`)

    this.socket.on('message', (raw: Buffer) => {
      const event = JSON.parse(raw.toString()) as ServerEvent
      const index = this.waiters.findIndex((w) => w.match(event))
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1)
        waiter.resolve(event)
      } else {
        this.buffer.push(event)
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve())
      this.socket.once('error', reject)
    })

    await this.wait('hello')
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }

  wait(type: string, timeoutMs = 8000): Promise<ServerEvent> {
    const match = (e: ServerEvent): boolean => e.type === type
    const index = this.buffer.findIndex(match)
    if (index >= 0) return Promise.resolve(this.buffer.splice(index, 1)[0])

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name}: не дождался события ${type}. Пришло: ${this.seen()}`))
      }, timeoutMs)
      this.waiters.push({
        match,
        resolve: (event) => {
          clearTimeout(timer)
          resolve(event)
        },
      })
    })
  }

  /** Убеждается, что событие НЕ пришло за отведённое время. */
  async never(type: string, ms = 1200): Promise<boolean> {
    try {
      await this.wait(type, ms)
      return false
    } catch {
      return true
    }
  }

  seen(): string {
    return this.buffer.map((e) => e.type).join(', ') || 'ничего'
  }

  clear(): void {
    this.buffer = []
  }

  /** Забирает всё, что накопилось, не дожидаясь конкретного события. */
  drain(): ServerEvent[] {
    return this.buffer.splice(0)
  }

  close(): void {
    this.socket.close()
  }
}

async function balanceOf(userId: number): Promise<number> {
  const row = await queryOne<{ coins_balance: number }>(
    'SELECT coins_balance FROM users WHERE id = $1',
    [userId],
  )
  return Number(row!.coins_balance)
}

async function ledgerSum(userId: number): Promise<number> {
  const row = await queryOne<{ total: string }>(
    'SELECT COALESCE(SUM(amount), 0)::text AS total FROM transactions WHERE user_id = $1',
    [userId],
  )
  return Number(row!.total)
}

async function setConfig(key: string, value: number): Promise<void> {
  await query('UPDATE app_config SET value = $1 WHERE key = $2', [JSON.stringify(value), key])
  invalidateEconomyCache()
}

/** Боты на время проверки не нужны: здесь всё про живых людей. */
async function setBotsEnabled(enabled: boolean): Promise<void> {
  await query('UPDATE app_config SET value = $1 WHERE key = $2', [
    JSON.stringify(enabled ? 1 : 0),
    'bots_enabled',
  ])
  await query(
    `UPDATE matches m SET status = 'cancelled', finished_at = now()
       FROM users u
      WHERE u.id = m.player1_id AND u.is_bot
        AND m.status = 'searching' AND m.player2_id IS NULL`,
  )
}

const BEATS: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' }

/**
 * Отматывает время прошлых вызовов назад. Нужно только проверке: сервер
 * не даёт слать вызовы очередью, а в проверке их за минуту набирается много.
 */
async function agePastChallenges(): Promise<void> {
  await query(
    `UPDATE matches SET created_at = created_at - INTERVAL '5 minutes'
      WHERE invited_id IS NOT NULL AND created_at > now() - INTERVAL '5 minutes'`,
  )
}

async function main(): Promise<void> {
  await connectRedis()
  await setBotsEnabled(false)

  const app = await buildServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const wsUrl = `ws://127.0.0.1:${port}`

  const stamp = Date.now() % 1_000_000

  async function login(telegramId: number, name: string): Promise<Client> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { telegramId, name },
    })
    const body = response.json() as { token: string; user: { id: number } }
    const client = new Client(name, body.user.id, body.token)
    await client.connect(wsUrl)
    return client
  }

  async function rest(
    token: string,
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as never,
    })
    return { status: response.statusCode, body: response.json() as Record<string, unknown> }
  }

  type FriendRow = {
    id: number
    nickname: string
    source: string
    online: boolean
    games: number
    wins: number
    losses: number
  }

  async function friendsOf(client: Client): Promise<FriendRow[]> {
    const response = await rest(client.token, 'GET', '/api/me/friends')
    return (response.body as { friends: FriendRow[] }).friends
  }

  try {
    await setConfig('round_seconds', 10)

    const anna = await login(920_000_000 + stamp, 'Анна')
    const boris = await login(920_100_000 + stamp, 'Борис')
    const stranger = await login(920_200_000 + stamp, 'Незнакомец')

    // ─── Пустой список ───────────────────────────────────────────────────────
    section('Список друзей')

    const emptyList = await friendsOf(anna)
    check(
      !emptyList.some((f) => f.id === boris.userId),
      'до первой встречи посторонних в списке нет',
      emptyList.map((f) => f.nickname),
    )

    // Приглашение по ссылке — первый способ попасть в друзья.
    await query(
      `INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)
       ON CONFLICT (referred_id) DO NOTHING`,
      [anna.userId, boris.userId],
    )

    const afterInvite = await friendsOf(anna)
    const borisAsFriend = afterInvite.find((f) => f.id === boris.userId)
    check(borisAsFriend !== undefined, 'приглашённый попал в список друзей')
    check(
      borisAsFriend?.source === 'invited',
      'видно, что человек пришёл по твоей ссылке',
      borisAsFriend,
    )
    check(borisAsFriend?.online === true, 'видно, что друг сейчас у экрана')

    const backwards = (await friendsOf(boris)).find((f) => f.id === anna.userId)
    check(backwards?.source === 'inviter', 'у приглашённого в списке — тот, кто позвал', backwards)

    check(
      (await friendsOf(anna)).every((f) => f.id !== anna.userId),
      'сам игрок в своём списке друзей не появляется',
    )

    const bots = await query<{ id: number }>('SELECT id FROM users WHERE is_bot LIMIT 5')
    check(
      (await friendsOf(anna)).every((f) => !bots.some((b) => b.id === f.id)),
      'боты в друзья не попадают',
    )

    // ─── Вызов и согласие ────────────────────────────────────────────────────
    section('Вызов на бой: согласие')

    const annaStart = await balanceOf(anna.userId)
    const borisStart = await balanceOf(boris.userId)

    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 25, rounds: 3, condition: 'кофе' })
    const sent = await anna.wait('challenge_sent')
    const received = await boris.wait('challenge_received')

    const challenge = received.challenge as {
      matchId: number
      from: { id: number; nickname: string }
      to: { id: number }
      bet: number
      rounds: number
      condition: string
      expiresAt: number
    }
    check(challenge.from.id === anna.userId, 'вызов пришёл от того, кто звал', challenge.from)
    check(challenge.bet === 25 && challenge.rounds === 3, 'условия боя переданы как есть')
    check(challenge.condition === 'кофе', 'условие пари дошло до друга')
    check(
      challenge.expiresAt - Date.now() > CHALLENGE_TTL_MS - 5000,
      'у вызова есть срок жизни',
      challenge.expiresAt - Date.now(),
    )
    check(
      (sent.challenge as { matchId: number }).matchId === challenge.matchId,
      'обе стороны говорят про один и тот же вызов',
    )

    check(
      (await balanceOf(anna.userId)) === annaStart &&
        (await balanceOf(boris.userId)) === borisStart,
      'пока вызов висит, медяки у обоих на месте',
    )

    // Посторонний не может влезть в чужой вызов.
    const stolen = await rest(stranger.token, 'POST', `/api/matches/${challenge.matchId}/join`)
    check(
      stolen.status === 403 && stolen.body.error === 'not_invited',
      'посторонний не может войти в чужой вызов',
      stolen.body,
    )

    boris.send({ type: 'challenge_accept', matchId: challenge.matchId })
    const annaFound = await anna.wait('match_found')
    const borisFound = await boris.wait('match_found')
    check(
      (annaFound.match as { id: number }).id === challenge.matchId &&
        (borisFound.match as { id: number }).id === challenge.matchId,
      'оба оказались в бою из вызова',
    )
    check(
      (annaFound.match as { condition: string | null }).condition === 'кофе',
      'условие пари видно в самом бою',
    )
    check(
      (await balanceOf(anna.userId)) === annaStart - 25 &&
        (await balanceOf(boris.userId)) === borisStart - 25,
      'ставки списались только в момент старта',
      { anna: await balanceOf(anna.userId), boris: await balanceOf(boris.userId) },
    )

    // Доигрываем: 2:0 в пользу Анны.
    for (let round = 0; round < 2; round += 1) {
      anna.send({ type: 'move', matchId: challenge.matchId, choice: 'rock' })
      boris.send({ type: 'move', matchId: challenge.matchId, choice: BEATS.rock })
      await anna.wait('round_result')
      if (round === 0) await anna.wait('round_started')
    }
    await anna.wait('match_finished')
    await boris.wait('match_finished')

    /*
     * Анна пригласила Бориса, и это был его первый платный матч — значит
     * вместе с выигрышем ей причитается реферальный бонус. Поэтому проверяем
     * выигрыш по проигравшему, а у победителя — что меньше ставки не стало.
     */
    check(
      (await balanceOf(boris.userId)) === borisStart - 25,
      'проигравший отдал ровно ставку',
      { before: borisStart, after: await balanceOf(boris.userId) },
    )
    check(
      (await balanceOf(anna.userId)) >= annaStart + 25,
      'победитель забрал обе ставки',
      { before: annaStart, after: await balanceOf(anna.userId) },
    )
    check(
      (await balanceOf(anna.userId)) === (await ledgerSum(anna.userId)),
      'баланс сходится с журналом операций',
    )

    // Сыгранный матч — второй способ попасть в друзья.
    const strangerFriends = await friendsOf(stranger)
    check(
      strangerFriends.length === 0,
      'у того, кто ни с кем не играл, список пуст',
      strangerFriends,
    )

    const annaFriends = await friendsOf(anna)
    const record = annaFriends.find((f) => f.id === boris.userId)
    check(record?.games === 1 && record?.wins === 1, 'личный счёт встреч посчитан', record)

    // ─── Отказ ───────────────────────────────────────────────────────────────
    section('Вызов на бой: отказ')

    anna.clear()
    boris.clear()
    const beforeDecline = await balanceOf(anna.userId)

    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 50, rounds: 1 })
    await anna.wait('challenge_sent')
    const second = (await boris.wait('challenge_received')).challenge as { matchId: number }

    boris.send({ type: 'challenge_decline', matchId: second.matchId })
    const declined = await anna.wait('challenge_declined')
    check(declined.matchId === second.matchId, 'позвавший узнал об отказе')
    check((await balanceOf(anna.userId)) === beforeDecline, 'отказ ничего не стоит')

    const afterDecline = await queryOne<{ status: string }>(
      'SELECT status FROM matches WHERE id = $1',
      [second.matchId],
    )
    check(afterDecline?.status === 'cancelled', 'отклонённый вызов закрыт в базе', afterDecline)

    const joinDeclined = await rest(boris.token, 'POST', `/api/matches/${second.matchId}/join`)
    check(
      joinDeclined.status === 409 && joinDeclined.body.error === 'match_not_joinable',
      'войти в отклонённый вызов уже нельзя',
      joinDeclined.body,
    )

    // ─── Отзыв вызова ────────────────────────────────────────────────────────
    section('Вызов можно отозвать')

    anna.clear()
    boris.clear()
    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 25, rounds: 1 })
    const third = (await anna.wait('challenge_sent')).challenge as { matchId: number }
    await boris.wait('challenge_received')

    anna.send({ type: 'challenge_cancel', matchId: third.matchId })
    const cancelled = await boris.wait('challenge_cancelled')
    check(cancelled.matchId === third.matchId, 'у друга окно вызова гаснет')

    // ─── Один вызов за раз ───────────────────────────────────────────────────
    section('Правила вежливости')

    anna.clear()
    boris.clear()
    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 25, rounds: 1 })
    const fourth = (await anna.wait('challenge_sent')).challenge as { matchId: number }
    await boris.wait('challenge_received')

    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 50, rounds: 3 })
    const fifth = (await anna.wait('challenge_sent')).challenge as { matchId: number }
    await boris.wait('challenge_received')

    const oldOne = await queryOne<{ status: string }>('SELECT status FROM matches WHERE id = $1', [
      fourth.matchId,
    ])
    check(
      oldOne?.status === 'cancelled' && fifth.matchId !== fourth.matchId,
      'новый вызов снимает предыдущий: очередь окон у друга не копится',
      oldOne,
    )

    anna.send({ type: 'challenge_cancel', matchId: fifth.matchId })
    await boris.wait('challenge_cancelled')

    // Незнакомца звать нельзя.
    anna.clear()
    anna.send({ type: 'challenge', toUserId: stranger.userId, bet: 25, rounds: 1 })
    const notConnected = await anna.wait('error')
    check(
      notConnected.code === 'not_connected',
      'позвать незнакомого человека нельзя',
      notConnected,
    )
    check(await stranger.never('challenge_received'), 'незнакомцу ничего не пришло')

    // Себя звать нельзя.
    anna.clear()
    anna.send({ type: 'challenge', toUserId: anna.userId, bet: 25, rounds: 1 })
    const self = await anna.wait('error')
    check(self.code === 'same_player', 'нельзя позвать самого себя', self)

    // Бота звать нельзя.
    await setBotsEnabled(true)
    const botRow = await queryOne<{ id: number }>('SELECT id FROM users WHERE is_bot LIMIT 1')
    if (botRow) {
      anna.clear()
      anna.send({ type: 'challenge', toUserId: botRow.id, bet: 25, rounds: 1 })
      const botError = await anna.wait('error')
      check(
        botError.code === 'not_connected' || botError.code === 'bot_not_invitable',
        'бота на бой позвать нельзя',
        botError,
      )
    }
    await setBotsEnabled(false)

    /*
     * Слишком частые вызовы. Ждём не по одному ответу, а разом: сервер должен
     * оборвать очередь, а не разослать другу шесть окон подряд.
     */
    anna.clear()
    boris.clear()
    await agePastChallenges()
    for (let attempt = 0; attempt < 6; attempt += 1) {
      anna.send({ type: 'challenge', toUserId: boris.userId, bet: 25, rounds: 1 })
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const answers = anna.drain()
    const limited = answers.find((event) => event.type === 'error')
    check(
      limited?.code === 'too_many_challenges',
      'вызовы подряд ограничены: другу нельзя устроить обстрел',
      answers.map((a) => a.type),
    )
    boris.clear()
    await query(
      `UPDATE matches SET status = 'cancelled', finished_at = now()
        WHERE player1_id = $1 AND invited_id IS NOT NULL AND status = 'pending'`,
      [anna.userId],
    )

    // ─── Срок вызова ─────────────────────────────────────────────────────────
    section('Вызов гаснет сам')

    await agePastChallenges()

    anna.clear()
    boris.clear()
    const beforeExpiry = await balanceOf(anna.userId)

    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 25, rounds: 1 })
    const sixth = (await anna.wait('challenge_sent')).challenge as { matchId: number }
    await boris.wait('challenge_received')

    // Отматываем срок назад — ждать минуту в проверке незачем.
    await query(`UPDATE matches SET expires_at = now() - INTERVAL '1 second' WHERE id = $1`, [
      sixth.matchId,
    ])

    const expiredForAnna = await anna.wait('challenge_expired', 15_000)
    const expiredForBoris = await boris.wait('challenge_expired', 15_000)
    check(
      expiredForAnna.matchId === sixth.matchId && expiredForBoris.matchId === sixth.matchId,
      'обе стороны узнали, что вызов погас',
    )
    check((await balanceOf(anna.userId)) === beforeExpiry, 'просроченный вызов ничего не стоит')

    const expiredRow = await queryOne<{ status: string }>(
      'SELECT status FROM matches WHERE id = $1',
      [sixth.matchId],
    )
    check(expiredRow?.status === 'expired', 'в базе вызов помечен просроченным', expiredRow)

    const joinExpired = await rest(boris.token, 'POST', `/api/matches/${sixth.matchId}/join`)
    check(joinExpired.status >= 400, 'войти в просроченный вызов нельзя', joinExpired.body)

    // ─── Возврат после обрыва связи ──────────────────────────────────────────
    section('Обрыв связи')

    await agePastChallenges()

    anna.clear()
    boris.clear()
    anna.send({ type: 'challenge', toUserId: boris.userId, bet: 25, rounds: 1 })
    const seventh = (await anna.wait('challenge_sent')).challenge as { matchId: number }
    await boris.wait('challenge_received')

    // Борис перезагрузил приложение — вызов должен вернуться на экран.
    boris.close()
    await new Promise((r) => setTimeout(r, 300))
    const borisAgain = new Client('Борис снова', boris.userId, boris.token)
    await borisAgain.connect(wsUrl)
    borisAgain.send({ type: 'challenges' })
    const restored = await borisAgain.wait('challenges')
    check(
      (restored.incoming as { matchId: number }[]).some((c) => c.matchId === seventh.matchId),
      'после перезагрузки вызов вернулся на экран',
      restored.incoming,
    )

    // А вот если вышел позвавший — вызов снимается: играть было бы не с кем.
    anna.close()
    const gone = await borisAgain.wait('challenge_cancelled', 5000)
    check(gone.matchId === seventh.matchId, 'вызов ушедшего игрока снимается')

    const goneRow = await queryOne<{ status: string }>('SELECT status FROM matches WHERE id = $1', [
      seventh.matchId,
    ])
    check(goneRow?.status === 'cancelled', 'в базе такой вызов закрыт', goneRow)

    check(
      (await balanceOf(boris.userId)) === (await ledgerSum(boris.userId)),
      'после всех вызовов баланс сходится с журналом',
    )

    borisAgain.close()
    stranger.close()
  } finally {
    await setConfig('round_seconds', 10)
    await setBotsEnabled(true)
    await app.close()
    await redis.quit()
    await pool.end()
  }

  console.log(`\nИтог: ${passed} прошло, ${failed} не прошло`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\nПроверка сорвалась:', error)
  process.exit(1)
})
