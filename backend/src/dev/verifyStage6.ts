import { createHash, createHmac } from 'node:crypto'
import WebSocket from 'ws'
import { buildServer } from '../server.js'
import { config } from '../config.js'
import { pool, query, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'
import { ensureAdminsFromEnv } from '../admin/auth.js'
import { invalidateEconomyCache } from '../domain/appConfig.js'
import {
  chooseFigure,
  ensureBots,
  getBotSettings,
  thinkingDelayMs,
  topUpOpenMatches,
  type BotSettings,
} from '../domain/bots.js'
import { botList, botOverview, players } from '../admin/queries.js'

/**
 * Проверка этапа 6: боты.
 *
 * Обещано было три вещи, и проверяются именно они, а не «код выглядит верно».
 *
 * 1. Бот не подглядывает. Фигура выбирается в момент открытия раунда, до
 *    любого хода соперника. В живом матче это видно так: бот ходит первым,
 *    а человек — только после того, как увидел «соперник сходил».
 * 2. Бот не пропускает ход. Пауза на размышление всегда короче раунда, даже
 *    если в админке выставить заведомо дурные значения.
 * 3. Бота нельзя обыграть скриптом. Выбор равномерно случайный, поэтому любая
 *    стратегия — хоть «всегда камень», хоть предсказание по истории — даёт
 *    ровно треть побед, треть поражений, треть ничьих.
 *
 * Запуск: npm run verify:stage6
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

// ─── Тестовый клиент ─────────────────────────────────────────────────────────

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

  wait(type: string, timeoutMs = 20_000): Promise<ServerEvent> {
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

  /** Ждёт первое из нескольких событий: раунд может как продолжиться, так и закончить матч. */
  waitAny(types: string[], timeoutMs = 20_000): Promise<ServerEvent> {
    const match = (e: ServerEvent): boolean => types.includes(e.type)
    const index = this.buffer.findIndex(match)
    if (index >= 0) return Promise.resolve(this.buffer.splice(index, 1)[0])

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`${this.name}: не дождался ни одного из ${types.join('/')}. Пришло: ${this.seen()}`),
        )
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

// ─── Помощники ───────────────────────────────────────────────────────────────

const BEATS: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' }

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

/** Подпись виджета входа Telegram — вход в админку. */
function loginQuery(telegramId: number, botToken: string, name = 'Владелец'): string {
  const fields: Record<string, string> = {
    id: String(telegramId),
    first_name: name,
    auth_date: String(Math.floor(Date.now() / 1000)),
  }
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
  const secret = createHash('sha256').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex')
  return new URLSearchParams({ ...fields, hash }).toString()
}

async function main(): Promise<void> {
  await connectRedis()

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

  try {
    await setConfig('round_seconds', 10)

    // ─── Выбор фигуры ────────────────────────────────────────────────────────
    section('Как бот выбирает фигуру')

    const SAMPLES = 30_000
    const counts: Record<string, number> = { rock: 0, scissors: 0, paper: 0 }
    const sequence: string[] = []
    for (let i = 0; i < SAMPLES; i += 1) {
      const choice = chooseFigure()
      counts[choice] += 1
      sequence.push(choice)
    }
    const expected = SAMPLES / 3
    const drift = Math.max(...Object.values(counts).map((c) => Math.abs(c - expected) / expected))
    check(drift < 0.05, 'все три фигуры выпадают одинаково часто', counts)

    // Стратегия «всегда камень» — самая простая попытка обыграть.
    let alwaysRockWins = 0
    for (const choice of sequence) if (BEATS.rock === choice) alwaysRockWins += 1
    check(
      Math.abs(alwaysRockWins / SAMPLES - 1 / 3) < 0.02,
      'постоянная фигура даёт ровно треть побед — обыграть бота ею нельзя',
      { winRate: (alwaysRockWins / SAMPLES).toFixed(4) },
    )

    /*
     * Стратегия посильнее: предсказатель считает, что бот повторяет привычки,
     * и ставит контрфигуру к его самому частому ходу. Так работала бы и
     * нейросеть, которую подключил бы игрок. Против случайного соперника это
     * не даёт ничего — что и требуется показать.
     */
    const seen: Record<string, number> = { rock: 0, scissors: 0, paper: 0 }
    const COUNTER: Record<string, string> = { rock: 'paper', scissors: 'rock', paper: 'scissors' }
    let predictorWins = 0
    let predictorLosses = 0
    for (const actual of sequence) {
      const favourite = (Object.keys(seen) as string[]).reduce((a, b) => (seen[a] >= seen[b] ? a : b))
      const guess = COUNTER[favourite]
      if (BEATS[guess] === actual) predictorWins += 1
      else if (BEATS[actual] === guess) predictorLosses += 1
      seen[actual] += 1
    }
    check(
      Math.abs(predictorWins / SAMPLES - 1 / 3) < 0.02,
      'предсказание по истории ходов не даёт преимущества',
      { wins: (predictorWins / SAMPLES).toFixed(4), losses: (predictorLosses / SAMPLES).toFixed(4) },
    )
    check(
      predictorWins / Math.max(1, predictorWins + predictorLosses) < 0.55,
      'в решённых раундах предсказатель не выходит за половину',
      {
        rate: (predictorWins / Math.max(1, predictorWins + predictorLosses)).toFixed(4),
      },
    )

    // ─── Пауза на размышление ────────────────────────────────────────────────
    section('Бот не пропускает ход')

    const normal: BotSettings = {
      enabled: true,
      openMatches: 3,
      minBet: 25,
      maxBet: 100,
      moveMinMs: 1500,
      moveMaxMs: 7000,
    }
    const delays: number[] = []
    for (let i = 0; i < 5000; i += 1) delays.push(thinkingDelayMs(normal, 10))
    check(
      delays.every((d) => d >= 1500 && d <= 8500),
      'при раунде в 10 секунд бот думает от полутора до восьми с половиной',
      { min: Math.min(...delays), max: Math.max(...delays) },
    )
    check(
      new Set(delays).size > 1000,
      'пауза каждый раз разная, а не одинаковая, как у скрипта',
      new Set(delays).size,
    )

    // Заведомо дурные настройки: минута на размышление при раунде в 10 секунд.
    const absurd: BotSettings = { ...normal, moveMinMs: 60_000, moveMaxMs: 90_000 }
    const absurdDelays: number[] = []
    for (let i = 0; i < 500; i += 1) absurdDelays.push(thinkingDelayMs(absurd, 10))
    check(
      absurdDelays.every((d) => d <= 8500),
      'ошибка в настройках не приводит к пропуску хода',
      Math.max(...absurdDelays),
    )

    const shortRound: number[] = []
    for (let i = 0; i < 200; i += 1) shortRound.push(thinkingDelayMs(normal, 2))
    check(
      shortRound.every((d) => d > 0 && d <= 2000),
      'при коротком раунде бот успевает тем более',
      Math.max(...shortRound),
    )

    // ─── Профили ─────────────────────────────────────────────────────────────
    section('Профили ботов')

    const bots = await ensureBots(6)
    check(bots.length >= 6, 'нужное количество ботов заведено', bots.length)

    const profiles = await query<{
      id: number
      telegram_id: string
      nickname: string
      rating: number
      is_bot: boolean
      avatar_id: string
    }>('SELECT id, telegram_id::text, nickname, rating, is_bot, avatar_id FROM users WHERE is_bot')
    check(profiles.every((p) => p.is_bot === true), 'все помечены как боты в базе')
    check(
      profiles.every((p) => Number(p.telegram_id) < -1_000_000 + 1),
      'номера ботов лежат вне диапазона живых аккаунтов',
      profiles.map((p) => p.telegram_id).slice(0, 3),
    )
    check(
      profiles.every((p) => /^[А-Яа-яЁё]+ [А-ЯЁ]\.$/.test(p.nickname)),
      'имена выглядят как обычные телеграмные, а не как «Бот №1»',
      profiles.map((p) => p.nickname).slice(0, 5),
    )
    check(
      profiles.every((p) => p.rating >= 900 && p.rating < 1150),
      'рейтинг около стартового: не мастер и не жертва',
      profiles.map((p) => p.rating),
    )
    check(
      profiles.every((p) => p.avatar_id && p.avatar_id.length > 0),
      'у каждого бота есть аватар',
    )

    const firstBot = profiles[0]
    check(
      (await balanceOf(firstBot.id)) === (await ledgerSum(firstBot.id)),
      'баланс бота сходится с журналом операций: медяки не берутся из воздуха',
    )
    check(
      (await balanceOf(firstBot.id)) >= 1000,
      'у бота есть на что играть',
      await balanceOf(firstBot.id),
    )

    // ─── Открытые бои ────────────────────────────────────────────────────────
    section('Открытые бои от ботов')

    await setConfig('bots_enabled', 1)
    await setConfig('bots_open_matches', 3)
    await setConfig('bots_min_bet', 25)
    await setConfig('bots_max_bet', 50)

    // Чужие открытые бои убираем, чтобы считать только наши.
    await query(
      `UPDATE matches m SET status = 'cancelled', finished_at = now()
         FROM users u
        WHERE u.id = m.player1_id AND u.is_bot
          AND m.status = 'searching' AND m.player2_id IS NULL`,
    )

    const settings = await getBotSettings()
    check(settings.enabled === true, 'выключатель в админке читается', settings)
    check(settings.maxBet === 50, 'диапазон ставок читается из настроек', settings)

    const created = await topUpOpenMatches(settings)
    check(created === 3, 'боты открыли столько боёв, сколько указано в админке', created)

    const again = await topUpOpenMatches(settings)
    check(again === 0, 'повторный проход не плодит лишние бои', again)

    const human = await login(910_000_000 + stamp, 'Человек')
    const openList = await rest(human.token, 'GET', '/api/matches/open')
    const open = (openList.body as {
      matches: { id: number; bet: number; rounds: number; host: { nickname: string } }[]
    }).matches
    const botMatches = open.filter((m) => bots.some((b) => b.nickname === m.host.nickname))
    check(botMatches.length >= 3, 'бои ботов видны игроку в общем списке', open.length)
    check(
      botMatches.length > 0 && botMatches.every((m) => m.bet >= 25 && m.bet <= 50),
      'ставки боёв внутри заданного диапазона',
      botMatches.map((m) => m.bet),
    )
    check(
      botMatches.length > 0 && botMatches.every((m) => [1, 3, 5].includes(m.rounds)),
      'число раундов обычное, как у людей',
      botMatches.map((m) => m.rounds),
    )

    await setConfig('bots_enabled', 0)
    const offSettings = await getBotSettings()
    check(offSettings.enabled === false, 'выключатель гасит ботов в настройках')
    check(
      (await topUpOpenMatches(offSettings)) === 0,
      'при выключенных ботах новые бои не создаются',
    )
    await setConfig('bots_enabled', 1)

    // ─── Живой матч ──────────────────────────────────────────────────────────
    section('Живой матч: человек против бота')

    // Паузу делаем короче, чтобы проверка не длилась минуту. Границы те же.
    await setConfig('bots_move_min_ms', 1200)
    await setConfig('bots_move_max_ms', 2500)

    const target = botMatches[0]
    const humanBefore = await balanceOf(human.userId)

    const joined = await rest(human.token, 'POST', `/api/matches/${target.id}/join`)
    check(joined.status === 200, 'человек вошёл в бой бота', joined.body)

    const found = await human.wait('match_found')
    const matchId = (found.match as { id: number }).id
    const opponentName = (found.match as { opponent: { nickname: string } }).opponent.nickname
    check(matchId === target.id, 'матч тот самый, что был в списке')
    check(
      bots.some((b) => b.nickname === opponentName),
      'соперником стал бот',
      opponentName,
    )

    let rounds = 0
    let botMovedFirstEveryRound = true
    let finished: ServerEvent | null = null

    while (!finished && rounds < 12) {
      rounds += 1

      /*
       * Главная проверка этапа. Человек не ходит, пока не увидит «соперник
       * сходил». Значит бот выбрал фигуру, не имея на руках чужого хода:
       * подглядывать было не во что.
       */
      let sawOpponentFirst = false
      try {
        const moved = await human.wait('opponent_moved', 15_000)
        sawOpponentFirst = true
        if (rounds === 1) {
          check(
            !('choice' in moved) &&
              !['rock', 'paper', 'scissors'].some((f) => JSON.stringify(moved).includes(f)),
            'в сообщении «соперник сходил» фигуры нет',
            moved,
          )
        }
      } catch {
        botMovedFirstEveryRound = false
      }
      if (!sawOpponentFirst) break

      human.send({ type: 'move', matchId, choice: 'rock' })
      const outcome = await human.waitAny(['round_result', 'match_finished'], 15_000)
      if (outcome.type === 'match_finished') {
        finished = outcome
        break
      }
      const next = await human.waitAny(['round_started', 'match_finished'], 15_000)
      if (next.type === 'match_finished') finished = next
    }

    check(botMovedFirstEveryRound, 'бот ходил первым в каждом раунде: чужого хода он не видел')
    check(finished !== null, 'матч дошёл до конца', rounds)

    const finalView = finished!.match as {
      status: string
      won: boolean
      opponentLeft: boolean
      myScore: number
      opponentScore: number
      rounds: { opponentChoice: string | null; opponentTimedOut: boolean; result: string }[]
    }
    check(finalView.opponentLeft === false, 'бот не бросил матч на середине')
    check(
      finalView.rounds.every((r) => r.opponentTimedOut === false),
      'бот не пропустил ни одного хода по таймеру',
      finalView.rounds.map((r) => r.opponentTimedOut),
    )
    check(
      finalView.rounds.every((r) => r.opponentChoice !== null),
      'в каждом сыгранном раунде у бота есть фигура',
      finalView.rounds,
    )

    const botId = bots.find((b) => b.nickname === opponentName)!.id
    const roundRows = await query<{
      round_number: number
      p1: string | null
      p2: string | null
      ms1: number | null
      ms2: number | null
    }>(
      `SELECT round_number,
              player1_move_at::text AS p1, player2_move_at::text AS p2,
              EXTRACT(EPOCH FROM (player1_move_at - started_at)) * 1000 AS ms1,
              EXTRACT(EPOCH FROM (player2_move_at - started_at)) * 1000 AS ms2
         FROM rounds WHERE match_id = $1 ORDER BY round_number`,
      [matchId],
    )
    const matchRow = await queryOne<{ player1_id: number; player2_id: number; finish_reason: string }>(
      'SELECT player1_id, player2_id, finish_reason FROM matches WHERE id = $1',
      [matchId],
    )
    const botIsFirst = matchRow!.player1_id === botId
    const botTimes = roundRows
      .map((r) => Number(botIsFirst ? r.ms1 : r.ms2))
      .filter((ms) => Number.isFinite(ms))

    check(matchRow!.finish_reason === 'played', 'матч записан как доигранный', matchRow!.finish_reason)
    check(
      botTimes.length === roundRows.length && botTimes.length > 0,
      'сервер проставил время хода бота в каждом раунде',
      { rounds: roundRows.length, times: botTimes.length },
    )
    check(
      botTimes.every((ms) => ms >= 1000),
      'бот не отвечает мгновенно: со стороны это выглядит как человек',
      botTimes,
    )
    check(
      botTimes.every((ms) => ms <= 9000),
      'бот всегда укладывается в раунд',
      botTimes,
    )

    const humanAfter = await balanceOf(human.userId)
    check(
      humanAfter === (await ledgerSum(human.userId)),
      'баланс человека сходится с журналом после матча с ботом',
    )
    check(
      (await balanceOf(botId)) === (await ledgerSum(botId)),
      'баланс бота сходится с журналом: игра с ботом не печатает медяки',
    )
    check(
      Math.abs(humanAfter - humanBefore) === target.bet,
      'человек выиграл или проиграл ровно ставку',
      { humanBefore, humanAfter, bet: target.bet },
    )

    // ─── Админка ─────────────────────────────────────────────────────────────
    section('Что видно в админке')

    const overviewRow = await botOverview()
    check(overviewRow.total >= 6, 'панель считает ботов', overviewRow.total)
    check(overviewRow.decidedRounds >= 1, 'решённые раунды ботов посчитаны', overviewRow)
    check(
      overviewRow.botWins <= overviewRow.decidedRounds,
      'побед не больше, чем сыгранных раундов',
      overviewRow,
    )
    check(overviewRow.finishedMatches >= 1, 'законченные матчи ботов видны', overviewRow)

    const list = await botList()
    check(list.length >= 6, 'список ботов отдаётся', list.length)
    check(
      list.some((b) => b.games_played >= 1),
      'у сыгравшего бота посчитаны игры',
      list.map((b) => b.games_played),
    )

    const humanPlayers = await players('', 0, 100)
    const botIds = new Set(list.map((b) => b.id))
    check(
      humanPlayers.rows.every((p) => !botIds.has(p.id)),
      'в списке игроков ботов нет: для них отдельный раздел',
    )

    // Страницы должны открываться — за этим в панель и заходят.
    const botToken = config.TELEGRAM_BOT_TOKEN
    const adminTelegramId = config.adminTelegramIds[0]
    if (botToken && adminTelegramId) {
      await ensureAdminsFromEnv()
      const loginResponse = await app.inject({
        method: 'GET',
        url: `/admin/login/telegram?${loginQuery(adminTelegramId, botToken)}`,
      })
      const setCookie = loginResponse.headers['set-cookie']
      const cookie = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : String(setCookie).split(';')[0]
      check(loginResponse.statusCode === 302 && cookie.startsWith('knb_admin'), 'вход в панель работает')

      const botsPage = await app.inject({ method: 'GET', url: '/admin/bots', headers: { cookie } })
      check(botsPage.statusCode === 200, 'страница «Боты» открывается', botsPage.statusCode)
      check(botsPage.body.includes('bots_open_matches'), 'на странице есть настройка количества боёв')
      check(botsPage.body.includes('bots_move_max_ms'), 'на странице есть настройка паузы хода')
      check(
        botsPage.body.includes('%') && /побед/i.test(botsPage.body),
        'на странице виден процент побед бота',
      )

      const suspectsPage = await app.inject({
        method: 'GET',
        url: '/admin/suspects',
        headers: { cookie },
      })
      check(suspectsPage.statusCode === 200, 'страница «Подозрительные» открывается')

      const configPage = await app.inject({ method: 'GET', url: '/admin/config', headers: { cookie } })
      check(
        !configPage.body.includes('bots_enabled'),
        'настройки ботов не мешаются в экономике: у них своя страница',
      )

      // Изменение настройки через панель должно сохраняться и попадать в журнал.
      const before = await getBotSettings()
      const saved = await app.inject({
        method: 'POST',
        url: '/admin/bots/config',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ key: 'bots_open_matches', value: '4' }).toString(),
      })
      check(saved.statusCode === 302, 'настройка сохранена из панели', saved.statusCode)
      check((await getBotSettings()).openMatches === 4, 'новое значение читается сервером')

      const audited = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM admin_audit
          WHERE action = 'bots_config_change' AND created_at > now() - INTERVAL '1 minute'`,
      )
      check(Number(audited?.count ?? 0) >= 1, 'изменение записано в журнал', audited)

      // Чужие ключи через эту форму пройти не должны.
      const smuggle = await app.inject({
        method: 'POST',
        url: '/admin/bots/config',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ key: 'start_balance', value: '999999' }).toString(),
      })
      const startBalance = await queryOne<{ value: string }>(
        `SELECT value::text AS value FROM app_config WHERE key = 'start_balance'`,
      )
      check(
        smuggle.statusCode === 302 && Number(startBalance?.value) !== 999_999,
        'через форму ботов нельзя поменять экономику',
        startBalance,
      )

      await setConfig('bots_open_matches', before.openMatches)
    } else {
      console.log('  · страницы панели пропущены: нет TELEGRAM_BOT_TOKEN или ADMIN_TELEGRAM_IDS')
    }

    human.close()
  } finally {
    await setConfig('round_seconds', 10)
    await setConfig('bots_move_min_ms', 1500)
    await setConfig('bots_move_max_ms', 7000)
    await setConfig('bots_max_bet', 100)
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
