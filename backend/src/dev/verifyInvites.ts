import WebSocket from 'ws'
import { buildServer } from '../server.js'
import { pool, query, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'

/**
 * Проверка приглашения, которое можно не караулить.
 *
 * Главное, что здесь проверяется: человек отправил вызов и ушёл. Друг открыл
 * ссылку через час. Никто не потерял ни матча, ни медяков, и оба встретились,
 * когда обоим удобно.
 *
 * Плюс бонус за друга, приведённого ссылкой на бой.
 *
 * Запуск: npm run verify:invites
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
        reject(new Error(`${this.name}: не дождался ${type}. Пришло: ${this.seen()}`))
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

async function main(): Promise<void> {
  await connectRedis()

  const app = await buildServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const wsUrl = `ws://127.0.0.1:${port}`
  const stamp = Date.now() % 1_000_000

  async function login(telegramId: number, name: string, startParam?: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { telegramId, name, startParam },
    })
    return response.json() as {
      token: string
      user: { id: number; balance: number; isNew: boolean }
    }
  }

  async function connect(telegramId: number, name: string): Promise<Client> {
    const body = await login(telegramId, name)
    const client = new Client(name, body.user.id, body.token)
    await client.connect(wsUrl)
    return client
  }

  async function rest(token: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as never,
    })
    return { status: response.statusCode, body: response.json() as Record<string, unknown> }
  }

  try {
    // ─── Отправил и ушёл ─────────────────────────────────────────────────────
    section('Отправил приглашение и ушёл по своим делам')

    const host = await connect(950_000_000 + stamp, 'Хозяин')
    const hostStart = await balanceOf(host.userId)

    const created = await rest(host.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 3,
      condition: 'проигравший моет посуду',
    })
    const matchId = (created.body.match as { id: number }).id
    check(created.status === 200, 'приглашение создано')

    const row = await queryOne<{ expires_at: string; host_ready_at: string | null }>(
      'SELECT expires_at, host_ready_at FROM matches WHERE id = $1',
      [matchId],
    )
    check(row?.host_ready_at !== null, 'хозяин отмечен ожидающим, пока он на экране')
    const livesFor = new Date(row!.expires_at).getTime() - Date.now()
    check(
      livesFor > 23 * 60 * 60 * 1000,
      'приглашение живёт сутки, а не минуту',
      Math.round(livesFor / 3600000) + ' ч',
    )
    check((await balanceOf(host.userId)) === hostStart, 'ставка ещё не списана')

    // Хозяин закрывает приложение — приглашение остаётся жить.
    host.close()
    await new Promise((r) => setTimeout(r, 400))

    const afterLeave = await queryOne<{ status: string; host_ready_at: string | null }>(
      'SELECT status, host_ready_at FROM matches WHERE id = $1',
      [matchId],
    )
    check(afterLeave?.status === 'pending', 'приглашение не пропало после выхода хозяина')
    check(afterLeave?.host_ready_at === null, 'но караулить его хозяин больше не обязан')
    check((await balanceOf(host.userId)) === hostStart, 'выход ничего не стоил')

    // ─── Друг заходит позже ──────────────────────────────────────────────────
    section('Друг открывает ссылку, когда хозяина нет')

    const guest = await connect(950_100_000 + stamp, 'Друг')
    const guestStart = await balanceOf(guest.userId)

    const joined = await rest(guest.token, 'POST', `/api/matches/${matchId}/join`)
    check(joined.status === 200, 'друг вошёл по ссылке', joined.body)
    check(
      (joined.body as { waiting?: boolean }).waiting === true,
      'бой не начался: играть пока не с кем',
      joined.body,
    )
    check(
      (await balanceOf(guest.userId)) === guestStart,
      'у друга тоже ничего не списано',
    )

    const afterJoin = await queryOne<{ player2_id: number; guest_ready_at: string | null }>(
      'SELECT player2_id, guest_ready_at FROM matches WHERE id = $1',
      [matchId],
    )
    check(afterJoin?.player2_id === guest.userId, 'друг записан в матч')
    check(afterJoin?.guest_ready_at !== null, 'друг отмечен готовым и может уходить')

    /*
     * Ссылку могли переслать дальше — но место в матче одно.
     *
     * Раньше здесь была настоящая дыра: новый путь «войти и подождать»
     * записывал в матч любого, кто открыл ссылку, и вытеснял того,
     * кто уже ждал.
     */
    const stranger = await connect(950_800_000 + stamp, 'Посторонний')
    const late = await rest(stranger.token, 'POST', `/api/matches/${matchId}/join`)
    check(late.status === 409, 'третий по той же ссылке получает отказ: место занято', late)

    const stillGuest = await queryOne<{ player2_id: number }>(
      'SELECT player2_id FROM matches WHERE id = $1',
      [matchId],
    )
    check(stillGuest?.player2_id === guest.userId, 'друга из матча не вытеснили')

    // Просроченное приглашение — закрытая дверь.
    const stale = await rest(stranger.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 0,
      rounds: 3,
    })
    const staleId = (stale.body.match as { id: number }).id
    await query(`UPDATE matches SET expires_at = now() - INTERVAL '1 minute' WHERE id = $1`, [
      staleId,
    ])
    const tooLate = await rest(guest.token, 'POST', `/api/matches/${staleId}/join`)
    check(tooLate.status === 410, 'по истёкшему приглашению войти нельзя', tooLate)
    stranger.close()

    // ─── Хозяин возвращается ─────────────────────────────────────────────────
    section('Хозяин возвращается в приложение')

    const hostAgain = new Client('Хозяин снова', host.userId, host.token)
    await hostAgain.connect(wsUrl)

    const notice = await hostAgain.wait('invite_update', 6000)
    const invite = notice.invite as {
      matchId: number
      guestReady: boolean
      hostReady: boolean
      condition: string
      guest: { nickname: string }
    }
    check(invite.matchId === matchId, 'хозяину пришло окно про это приглашение')
    check(invite.guestReady === true, 'видно, что друг уже ждёт')
    check(invite.guest.nickname === 'Друг', 'видно, кто именно ждёт', invite.guest)
    check(invite.condition === 'проигравший моет посуду', 'условие пари не потерялось')

    // ─── «Позже» ─────────────────────────────────────────────────────────────
    section('«Сейчас неудобно»')

    hostAgain.clear()
    hostAgain.send({ type: 'invite_later', matchId })
    await new Promise((r) => setTimeout(r, 600))

    const snoozed = await queryOne<{ status: string; snoozed_until: string | null }>(
      'SELECT status, snoozed_until FROM matches WHERE id = $1',
      [matchId],
    )
    check(snoozed?.status === 'pending', 'приглашение осталось: «позже» — не отказ')
    check(snoozed?.snoozed_until !== null, 'окно замолчало на время', snoozed)

    hostAgain.close()
    await new Promise((r) => setTimeout(r, 300))
    const hostThird = new Client('Хозяин третий раз', host.userId, host.token)
    await hostThird.connect(wsUrl)
    check(
      await hostThird.never('invite_update', 1500),
      'после «позже» окно не всплывает при каждом входе',
    )

    // ─── Встретились ─────────────────────────────────────────────────────────
    section('Оба готовы — бой начинается сам')

    await query('UPDATE matches SET snoozed_until = NULL WHERE id = $1', [matchId])

    hostThird.clear()
    guest.clear()
    hostThird.send({ type: 'invite_ready', matchId })

    const hostFound = await hostThird.wait('match_found', 8000)
    const guestFound = await guest.wait('match_found', 8000)
    check(
      (hostFound.match as { id: number }).id === matchId &&
        (guestFound.match as { id: number }).id === matchId,
      'оба оказались в бою, и никто не сидел на экране ожидания',
    )
    check(
      (await balanceOf(host.userId)) === hostStart - 25 &&
        (await balanceOf(guest.userId)) === guestStart - 25,
      'ставки списались только теперь, когда бой начался',
      { host: await balanceOf(host.userId), guest: await balanceOf(guest.userId) },
    )
    check(
      (hostFound.match as { condition: string | null }).condition === 'проигравший моет посуду',
      'условие пари дошло до боя',
    )

    hostThird.close()
    guest.close()

    // ─── Бонус за друга по ссылке на бой ─────────────────────────────────────
    section('Бонус за друга, приведённого ссылкой на бой')

    const inviter = await connect(950_200_000 + stamp, 'Пригласивший')
    const invite2 = await rest(inviter.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 1,
    })
    const inviteMatchId = (invite2.body.match as { id: number }).id

    // Новый человек открывает игру по ссылке на этот бой.
    const newcomer = await login(950_300_000 + stamp, 'Новичок', `match_${inviteMatchId}`)
    check(newcomer.user.isNew === true, 'это действительно новый игрок')

    const link = await queryOne<{ referrer_id: number; bonus_paid: boolean }>(
      'SELECT referrer_id, bonus_paid FROM referrals WHERE referred_id = $1',
      [newcomer.user.id],
    )
    check(
      link?.referrer_id === inviter.userId,
      'приглашение на бой засчитано как приведённый друг',
      link,
    )
    check(link?.bonus_paid === false, 'бонус пока не выплачен — ждём первого матча новичка')

    const inviterBefore = await balanceOf(inviter.userId)

    // Новичок играет первый матч — тут и приходит бонус пригласившему.
    const newcomerClient = new Client('Новичок', newcomer.user.id, newcomer.token)
    await newcomerClient.connect(wsUrl)
    const rival = await connect(950_400_000 + stamp, 'Соперник')

    const quick = await rest(newcomerClient.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 1,
    })
    const quickId = (quick.body.match as { id: number }).id
    await rest(rival.token, 'POST', `/api/matches/${quickId}/join`)
    await newcomerClient.wait('match_found')
    await rival.wait('match_found')

    newcomerClient.send({ type: 'move', matchId: quickId, choice: 'rock' })
    rival.send({ type: 'move', matchId: quickId, choice: 'scissors' })
    await newcomerClient.wait('match_finished', 12_000)

    const inviterAfter = await balanceOf(inviter.userId)
    check(
      inviterAfter > inviterBefore,
      'пригласившему начислен бонус после первого матча новичка',
      { before: inviterBefore, after: inviterAfter },
    )
    check(
      inviterAfter === (await ledgerSum(inviter.userId)),
      'бонус прошёл через журнал операций',
    )

    const paid = await queryOne<{ bonus_paid: boolean }>(
      'SELECT bonus_paid FROM referrals WHERE referred_id = $1',
      [newcomer.user.id],
    )
    check(paid?.bonus_paid === true, 'выплата отмечена — второй раз не начислится')

    newcomerClient.close()
    rival.close()
    inviter.close()
  } finally {
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
