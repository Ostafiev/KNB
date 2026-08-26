import WebSocket from 'ws'
import { buildServer } from '../server.js'
import { pool, query, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'
import { invalidateEconomyCache } from '../domain/appConfig.js'

/**
 * Проверка этапа 4: настоящий матч между двумя игроками.
 *
 * Запускает настоящий сервер, подключает к нему два WebSocket-соединения
 * и играет живые матчи — с подбором соперника, ходами, таймаутами и выходом
 * из боя. Проверяется не код по отдельности, а поведение целиком:
 * доходят ли события, сходится ли баланс с журналом, честно ли считается счёт.
 *
 * Запуск: npm run verify:stage4
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
    if (detail !== undefined) console.log('    ', JSON.stringify(detail))
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

    // Слушателя вешаем до открытия: сервер здоровается сразу, и без слушателя
    // это приветствие потерялось бы.
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

  /** Ждёт событие нужного типа, учитывая уже пришедшие. */
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

async function statsOf(userId: number): Promise<{ rating: number; games: number; wins: number }> {
  const row = await queryOne<{ rating: number; games_played: number; wins: number }>(
    'SELECT rating, games_played, wins FROM users WHERE id = $1',
    [userId],
  )
  return { rating: row!.rating, games: row!.games_played, wins: row!.wins }
}

async function setRoundSeconds(seconds: number): Promise<void> {
  await query('UPDATE app_config SET value = $1 WHERE key = $2', [
    JSON.stringify(seconds),
    'round_seconds',
  ])
  invalidateEconomyCache()
}

/** Ходы, дающие заранее известный результат. */
const BEATS: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' }
const LOSES_TO: Record<string, string> = { rock: 'paper', scissors: 'rock', paper: 'scissors' }

async function main(): Promise<void> {
  await connectRedis()
  await redis.flushdb()

  const app = await buildServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const wsUrl = `ws://127.0.0.1:${port}`

  const stamp = Date.now() % 1_000_000

  async function login(telegramId: number, name: string, startParam?: string): Promise<Client> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { telegramId, name },
    })
    const body = response.json() as { token: string; user: { id: number } }

    if (startParam) {
      // Приглашение засчитывается при первом входе, поэтому для реферала
      // используем отдельный вход с параметром ссылки.
      throw new Error('startParam обрабатывается отдельно')
    }

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
    await setRoundSeconds(10)

    // ─── Матч со ставкой от подбора до итогов ────────────────────────────────
    section('Матч со ставкой: подбор, раунды, выплата')

    const alice = await login(900_000_000 + stamp, 'Алиса')
    const bob = await login(900_100_000 + stamp, 'Борис')

    const aliceStart = await balanceOf(alice.userId)
    const bobStart = await balanceOf(bob.userId)
    check(aliceStart >= 100 && bobStart >= 100, 'у обоих есть медяки на старте', {
      aliceStart,
      bobStart,
    })

    alice.send({ type: 'queue', bet: 25, rounds: 3 })
    const queued = await alice.wait('queue_joined')
    check(queued.bet === 25, 'первый игрок встал в очередь')
    check(typeof queued.matchId === 'number', 'ожидающий бой заведён в базе', queued)

    // Главное, чего не хватало: открытый бой должен быть виден другому игроку.
    const openForBob = await rest(bob.token, 'GET', '/api/matches/open')
    const openList = (openForBob.body as { matches: { id: number; host: { nickname: string } }[] })
      .matches
    check(
      openList.some((m) => m.id === queued.matchId),
      'открытый бой виден второму игроку в общем списке',
      openList,
    )
    check(
      openList.find((m) => m.id === queued.matchId)?.host.nickname === 'Алиса',
      'в списке видно, кто ждёт соперника',
    )

    const openForAlice = await rest(alice.token, 'GET', '/api/matches/open')
    check(
      !(openForAlice.body as { matches: { id: number }[] }).matches.some(
        (m) => m.id === queued.matchId,
      ),
      'свой бой в списке не показывается',
    )

    bob.send({ type: 'queue', bet: 25, rounds: 3 })

    const aliceFound = await alice.wait('match_found')
    const bobFound = await bob.wait('match_found')
    const matchId = (aliceFound.match as { id: number }).id
    check(matchId === (bobFound.match as { id: number }).id, 'оба попали в один матч')
    check(
      (aliceFound.match as { opponent: { nickname: string } }).opponent.nickname === 'Борис',
      'соперник виден с именем',
    )

    check(
      (await balanceOf(alice.userId)) === aliceStart - 25 &&
        (await balanceOf(bob.userId)) === bobStart - 25,
      'ставка списана с обоих',
      { alice: await balanceOf(alice.userId), bob: await balanceOf(bob.userId) },
    )

    // Раунд 1: выигрывает Алиса
    alice.send({ type: 'move', matchId, choice: 'rock' })
    const accepted = await alice.wait('move_accepted')
    check(accepted.choice === 'rock', 'ход принят')

    const opponentMoved = await bob.wait('opponent_moved')
    check(
      !('choice' in opponentMoved) && !JSON.stringify(opponentMoved).includes('rock'),
      'до конца раунда чужая фигура не раскрывается',
      opponentMoved,
    )

    bob.send({ type: 'move', matchId, choice: BEATS.rock })
    const round1 = await alice.wait('round_result')
    const view1 = round1.match as { myScore: number; opponentScore: number; rounds: { result: string }[] }
    check(view1.myScore === 1 && view1.opponentScore === 0, 'раунд 1 засчитан победителю', view1)
    check(
      (round1.match as { rounds: { opponentChoice: string | null }[] }).rounds[0].opponentChoice ===
        BEATS.rock,
      'после раунда чужая фигура открыта',
    )

    await alice.wait('round_started')

    // Раунд 2: ничья, потом переигровка
    alice.send({ type: 'move', matchId, choice: 'paper' })
    bob.send({ type: 'move', matchId, choice: 'paper' })
    const drawRound = await alice.wait('round_result')
    const drawView = drawRound.match as {
      myScore: number
      opponentScore: number
      currentRound: number
      rounds: { result: string; display: number }[]
    }
    check(drawView.myScore === 1 && drawView.opponentScore === 0, 'ничья не даёт очка')
    check(drawView.currentRound === 2, 'ничья не двигает счётчик раундов', drawView.currentRound)
    check(
      drawView.rounds[1].result === 'draw' && drawView.rounds[1].display === 2,
      'ничья сохранена в истории раунда',
      drawView.rounds[1],
    )
    await alice.wait('round_started')

    // Раунд 3: снова Алиса — матч закончен со счётом 2:0
    alice.send({ type: 'move', matchId, choice: 'scissors' })
    bob.send({ type: 'move', matchId, choice: BEATS.scissors })
    await alice.wait('round_result')

    const aliceFinish = await alice.wait('match_finished')
    const bobFinish = await bob.wait('match_finished')
    const aliceFinal = aliceFinish.match as {
      won: boolean
      myScore: number
      opponentScore: number
      coinsDelta: number
      ratingDelta: number
      opponentLeft: boolean
    }
    check(aliceFinal.won === true && aliceFinal.myScore === 2, 'победа засчитана Алисе', aliceFinal)
    check((bobFinish.match as { won: boolean }).won === false, 'поражение засчитано Борису')
    check(aliceFinal.opponentLeft === false, 'матч отмечен как доигранный, а не брошенный')

    const aliceAfter = await balanceOf(alice.userId)
    const bobAfter = await balanceOf(bob.userId)
    check(aliceAfter === aliceStart + 25, 'победитель забрал обе ставки', { aliceAfter, aliceStart })
    check(bobAfter === bobStart - 25, 'проигравший потерял свою ставку', { bobAfter, bobStart })

    const aliceStats = await statsOf(alice.userId)
    const bobStats = await statsOf(bob.userId)
    check(aliceStats.rating > 1000 && bobStats.rating < 1000, 'рейтинг пересчитан', {
      alice: aliceStats.rating,
      bob: bobStats.rating,
    })
    check(aliceStats.games === 1 && bobStats.games === 1, 'сыгранные игры посчитаны')
    check(aliceStats.wins === 1, 'победа записана в статистику')

    check(
      (await balanceOf(alice.userId)) === (await ledgerSum(alice.userId)),
      'баланс победителя сходится с журналом операций',
    )
    check(
      (await balanceOf(bob.userId)) === (await ledgerSum(bob.userId)),
      'баланс проигравшего сходится с журналом операций',
    )

    const finishedRow = await queryOne<{ finish_reason: string; score1: number; score2: number }>(
      'SELECT finish_reason, score1, score2 FROM matches WHERE id = $1',
      [matchId],
    )
    check(finishedRow!.finish_reason === 'played', 'причина завершения записана в базу')

    const roundRows = await query<{ player1_move_at: string | null; started_at: string }>(
      'SELECT player1_move_at, started_at FROM rounds WHERE match_id = $1 ORDER BY round_number',
      [matchId],
    )
    check(roundRows.length === 3, 'все три раунда сохранены, включая ничью', roundRows.length)
    check(
      roundRows.every((r) => r.player1_move_at !== null && r.started_at !== null),
      'время старта раунда и время хода проставлены сервером',
    )

    // ─── Отмена поиска ───────────────────────────────────────────────────────
    section('Отмена поиска')

    alice.clear()
    bob.clear()
    alice.send({ type: 'queue', bet: 50, rounds: 1 })
    const waiting2 = await alice.wait('queue_joined')

    const seenBefore = await rest(bob.token, 'GET', '/api/matches/open?bet=50')
    check(
      (seenBefore.body as { matches: { id: number }[] }).matches.some(
        (m) => m.id === waiting2.matchId,
      ),
      'бой появился в списке',
    )

    alice.send({ type: 'queue_cancel' })
    await alice.wait('queue_left')

    const seenAfter = await rest(bob.token, 'GET', '/api/matches/open?bet=50')
    check(
      !(seenAfter.body as { matches: { id: number }[] }).matches.some(
        (m) => m.id === waiting2.matchId,
      ),
      'после отмены бой пропал из списка',
    )
    check(
      (await balanceOf(alice.userId)) === (await ledgerSum(alice.userId)),
      'ожидание и отмена не тронули баланс',
    )

    // ─── Вход в открытый бой нажатием ────────────────────────────────────────
    section('Вход в открытый бой из списка')

    alice.clear()
    bob.clear()
    alice.send({ type: 'queue', bet: 25, rounds: 1 })
    const waiting3 = await alice.wait('queue_joined')

    const joined = await rest(bob.token, 'POST', `/api/matches/${waiting3.matchId}/join`)
    check(joined.status === 200, 'второй игрок вошёл в выбранный бой', joined.body)
    await alice.wait('match_found')
    await bob.wait('match_found')
    check(true, 'создатель боя узнал о входе соперника')

    alice.send({ type: 'move', matchId: waiting3.matchId as number, choice: 'rock' })
    bob.send({ type: 'move', matchId: waiting3.matchId as number, choice: BEATS.rock })
    await alice.wait('match_finished')
    await bob.wait('match_finished')

    // ─── Правила и запреты ───────────────────────────────────────────────────
    section('Правила и запреты')

    alice.clear()
    alice.send({ type: 'queue', bet: 0, rounds: 3 })
    const freeError = await alice.wait('error')
    check(freeError.code === 'free_only_friend', 'бесплатно в случайном подборе нельзя', freeError)

    alice.send({ type: 'move', matchId, choice: 'rock' })
    const notActive = await alice.wait('error')
    check(notActive.code === 'match_not_active', 'ход в законченный матч отклонён', notActive)

    const selfJoin = await rest(alice.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 3,
    })
    const selfMatchId = (selfJoin.body.match as { id: number }).id
    const selfJoinResult = await rest(alice.token, 'POST', `/api/matches/${selfMatchId}/join`)
    check(selfJoinResult.status === 400, 'нельзя играть с самим собой', selfJoinResult.body)
    await rest(alice.token, 'POST', `/api/matches/${selfMatchId}/leave`)

    // ─── Матч по приглашению и двойной ход ───────────────────────────────────
    section('Приглашение друга и повторный ход')

    alice.clear()
    bob.clear()
    const invite = await rest(alice.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 3,
      condition: 'проигравший ставит кофе',
    })
    const inviteId = (invite.body.match as { id: number }).id
    check(invite.body.startParam === `match_${inviteId}`, 'ссылка-приглашение собрана')

    const seenByGuest = await rest(bob.token, 'GET', `/api/matches/${inviteId}`)
    check(
      (seenByGuest.body.invite as { condition: string }).condition === 'проигравший ставит кофе',
      'приглашённый видит условия до входа',
    )

    await rest(bob.token, 'POST', `/api/matches/${inviteId}/join`)
    await alice.wait('match_found')
    await bob.wait('match_found')
    check(true, 'приглашающий узнал о входе друга без обновления страницы')

    alice.send({ type: 'move', matchId: inviteId, choice: 'rock' })
    await alice.wait('move_accepted')
    alice.send({ type: 'move', matchId: inviteId, choice: 'paper' })
    const doubleMove = await alice.wait('error')
    check(doubleMove.code === 'already_moved', 'второй ход в том же раунде отклонён', doubleMove)

    // ─── Выход из матча ──────────────────────────────────────────────────────
    section('Выход из матча')

    // Первый раунд Алиса выигрывает: он должен остаться засчитанным даже
    // после того, как она бросит матч.
    bob.send({ type: 'move', matchId: inviteId, choice: BEATS.rock })
    await alice.wait('round_result')
    await alice.wait('round_started')

    // Второй раунд начат: Борис ходит, Алиса выходит не сходив.
    bob.send({ type: 'move', matchId: inviteId, choice: 'rock' })
    await bob.wait('move_accepted')

    alice.send({ type: 'leave', matchId: inviteId })
    const bobWins = await bob.wait('match_finished')
    const bobWinView = bobWins.match as {
      won: boolean
      myScore: number
      opponentScore: number
      opponentLeft: boolean
      rounds: { result: string; myChoice: string | null }[]
    }
    check(bobWinView.won === true, 'ушедшему засчитано техническое поражение')
    check(bobWinView.opponentLeft === true, 'в итогах видно, что соперник вышел')
    check(
      bobWinView.opponentScore === 1,
      'сыгранный раунд остался засчитанным ушедшему',
      bobWinView.opponentScore,
    )
    check(
      bobWinView.myScore === 1,
      'незаконченный раунд засчитан ушедшему как проигранный',
      bobWinView.myScore,
    )
    check(
      bobWinView.rounds[0].myChoice === BEATS.rock,
      'фигуры сыгранного раунда сохранились',
      bobWinView.rounds[0],
    )

    const abandonedRow = await queryOne<{ finish_reason: string }>(
      'SELECT finish_reason FROM matches WHERE id = $1',
      [inviteId],
    )
    check(abandonedRow!.finish_reason === 'abandoned', 'в базе записано, что матч бросили')

    check(
      (await balanceOf(bob.userId)) === (await ledgerSum(bob.userId)),
      'после брошенного матча баланс сходится с журналом',
    )

    // ─── Таймаут ─────────────────────────────────────────────────────────────
    section('Таймер раунда')

    await setRoundSeconds(2)
    alice.clear()
    bob.clear()

    const timeoutInvite = await rest(alice.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 1,
    })
    const timeoutId = (timeoutInvite.body.match as { id: number }).id
    await rest(bob.token, 'POST', `/api/matches/${timeoutId}/join`)
    await alice.wait('match_found')
    await bob.wait('match_found')

    // Ходит только Борис. Алиса молчит — раунд должен уйти Борису по таймеру.
    bob.send({ type: 'move', matchId: timeoutId, choice: 'rock' })
    await bob.wait('move_accepted')

    const timedOut = await bob.wait('match_finished', 12_000)
    const timedOutView = timedOut.match as {
      won: boolean
      rounds: { opponentTimedOut: boolean; result: string }[]
    }
    check(timedOutView.won === true, 'не сходивший проиграл раунд по таймеру')
    check(
      timedOutView.rounds[0].opponentTimedOut === true,
      'таймаут отмечен в раунде',
      timedOutView.rounds[0],
    )

    // ─── Переподключение ─────────────────────────────────────────────────────
    section('Переподключение к идущему матчу')

    alice.clear()
    bob.clear()
    await setRoundSeconds(10)

    const resumeInvite = await rest(alice.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 3,
    })
    const resumeId = (resumeInvite.body.match as { id: number }).id
    await rest(bob.token, 'POST', `/api/matches/${resumeId}/join`)
    await alice.wait('match_found')
    await bob.wait('match_found')

    alice.send({ type: 'move', matchId: resumeId, choice: 'rock' })
    await alice.wait('move_accepted')

    alice.close()
    await new Promise((r) => setTimeout(r, 300))

    const aliceAgain = new Client('Алиса снова', alice.userId, alice.token)
    await aliceAgain.connect(wsUrl)
    aliceAgain.send({ type: 'resume', matchId: resumeId })
    const state = await aliceAgain.wait('match_state')
    const stateView = state.match as { status: string; rounds: { myChoice: string | null }[] }
    check(stateView.status === 'active', 'после переподключения матч всё ещё идёт')
    check(stateView.rounds[0].myChoice === 'rock', 'свой ход не потерялся при обрыве связи')
    check(typeof state.roundEndsAt === 'number', 'сервер сообщил, когда истекает раунд')

    aliceAgain.send({ type: 'leave', matchId: resumeId })
    await bob.wait('match_finished')
    aliceAgain.close()

    // ─── Бесплатный матч с другом ────────────────────────────────────────────
    section('Бесплатный матч с другом')

    bob.clear()
    const carol = await login(900_200_000 + stamp, 'Кира')

    const freeBalanceBefore = await balanceOf(carol.userId)
    const freeStatsBefore = await statsOf(carol.userId)

    const freeInvite = await rest(carol.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 0,
      rounds: 1,
    })
    const freeId = (freeInvite.body.match as { id: number }).id
    await rest(bob.token, 'POST', `/api/matches/${freeId}/join`)
    await carol.wait('match_found')
    await bob.wait('match_found')

    carol.send({ type: 'move', matchId: freeId, choice: 'rock' })
    bob.send({ type: 'move', matchId: freeId, choice: LOSES_TO.rock })
    await carol.wait('match_finished')

    const freeStatsAfter = await statsOf(carol.userId)
    check((await balanceOf(carol.userId)) === freeBalanceBefore, 'бесплатный матч не трогает баланс')
    check(freeStatsAfter.rating === freeStatsBefore.rating, 'бесплатный матч не трогает рейтинг')
    check(
      freeStatsAfter.games === freeStatsBefore.games,
      'бесплатный матч не идёт в счётчик сыгранных игр',
    )

    // ─── Реферальный бонус после первого матча ───────────────────────────────
    section('Реферальный бонус после первого матча приглашённого')

    const inviterCode = await queryOne<{ referral_code: string }>(
      'SELECT referral_code FROM users WHERE id = $1',
      [alice.userId],
    )

    const inviteeResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { telegramId: 900_300_000 + stamp, name: 'Новичок' },
    })
    const inviteeBody = inviteeResponse.json() as { token: string; user: { id: number } }

    // Приглашение проставляется при первом входе, поэтому связь создаём так же,
    // как это сделал бы вход по ссылке ref_<код>.
    await query(
      `INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)
       ON CONFLICT (referred_id) DO NOTHING`,
      [alice.userId, inviteeBody.user.id],
    )
    check(inviterCode!.referral_code.length > 0, 'у пригласившего есть реферальный код')

    const invitee = new Client('Новичок', inviteeBody.user.id, inviteeBody.token)
    await invitee.connect(wsUrl)

    const inviterBefore = await balanceOf(alice.userId)
    const paidBefore = await queryOne<{ bonus_paid: boolean }>(
      'SELECT bonus_paid FROM referrals WHERE referred_id = $1',
      [invitee.userId],
    )
    check(paidBefore!.bonus_paid === false, 'до первого матча бонус не выплачен')

    bob.clear()
    const refInvite = await rest(invitee.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 1,
    })
    const refId = (refInvite.body.match as { id: number }).id
    await rest(bob.token, 'POST', `/api/matches/${refId}/join`)
    await invitee.wait('match_found')
    await bob.wait('match_found')

    invitee.send({ type: 'move', matchId: refId, choice: 'rock' })
    bob.send({ type: 'move', matchId: refId, choice: LOSES_TO.rock })
    await invitee.wait('match_finished')

    const inviterAfter = await balanceOf(alice.userId)
    check(inviterAfter === inviterBefore + 100, 'пригласившему начислен бонус', {
      inviterBefore,
      inviterAfter,
    })

    const paidAfter = await queryOne<{ bonus_paid: boolean }>(
      'SELECT bonus_paid FROM referrals WHERE referred_id = $1',
      [invitee.userId],
    )
    check(paidAfter!.bonus_paid === true, 'выплата отмечена в таблице приглашений')

    const summary = await rest(alice.token, 'GET', '/api/me/referrals')
    check(
      (summary.body as { earned: number }).earned === 100,
      'сводка приглашений показывает заработок',
      summary.body,
    )

    // Второй матч того же новичка не должен принести второй бонус
    bob.clear()
    const refInvite2 = await rest(invitee.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 1,
    })
    const refId2 = (refInvite2.body.match as { id: number }).id
    await rest(bob.token, 'POST', `/api/matches/${refId2}/join`)
    await invitee.wait('match_found')
    invitee.send({ type: 'move', matchId: refId2, choice: 'rock' })
    bob.send({ type: 'move', matchId: refId2, choice: LOSES_TO.rock })
    await invitee.wait('match_finished')

    check(
      (await balanceOf(alice.userId)) === inviterAfter,
      'второй матч не приносит второго бонуса',
    )

    // ─── История ─────────────────────────────────────────────────────────────
    section('История матчей и операций')

    const history = await rest(bob.token, 'GET', '/api/me/matches?limit=5')
    const historyList = (history.body as { matches: { finished: boolean; opponent: unknown }[] })
      .matches
    check(historyList.length > 0, 'история матчей отдаётся')
    check(
      historyList.every((m) => m.finished && m.opponent !== null),
      'в истории только законченные матчи и виден соперник',
    )

    const transactions = await rest(bob.token, 'GET', '/api/me/transactions?limit=50')
    const list = (transactions.body as { transactions: { type: string }[] }).transactions
    check(
      list.some((t) => t.type === 'bet_hold') && list.some((t) => t.type === 'match_win'),
      'в истории операций видны ставки и выигрыши',
    )

    check(
      (await balanceOf(bob.userId)) === (await ledgerSum(bob.userId)),
      'итоговый баланс Бориса сходится с журналом',
    )
    check(
      (await balanceOf(alice.userId)) === (await ledgerSum(alice.userId)),
      'итоговый баланс Алисы сходится с журналом',
    )

    alice.close()
    bob.close()
    carol.close()
    invitee.close()
  } finally {
    await setRoundSeconds(10)
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
