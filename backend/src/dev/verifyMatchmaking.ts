/*
 * Проверка обещания «соперник не дольше десяти секунд».
 *
 * Раньше подбор работал так: боты держали три открытых боя со случайными
 * ставками, а человек попадал к ним только при совпадении и ставки, и числа
 * раундов. Выбрал непопулярные условия — жди неизвестно сколько. Формально
 * подбор работал, фактически человек сидел у песочных часов и уходил.
 *
 * Теперь у живого соперника есть фора в несколько секунд, а дальше в бой
 * заходит бот. Здесь это и проверяется — на самых неудобных условиях,
 * какие можно выбрать.
 *
 * Запуск: npm run verify:matchmaking
 */

import WebSocket from 'ws'
import { buildServer } from '../server.js'
import { closePool, query, queryOne } from '../db/client.js'
import { closeRedis } from '../lib/redis.js'
import { randomNickname } from '../domain/nicknames.js'
import {
  churnOpenMatches,
  ensureBots,
  getBotSettings,
  topUpOpenMatches,
} from '../domain/bots.js'

let passed = 0
let failed = 0

function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
    failed++
  }
}

/** Обещание, которое проверяем. Заявлено «до десяти секунд». */
const PROMISE_MS = 10_000

async function main(): Promise<void> {
  const app = await buildServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const wsUrl = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/ws`
  const stamp = Date.now() % 1_000_000

  console.log('\nНики')

  const sample = Array.from({ length: 200 }, () => randomNickname())
  check(
    sample.every((nick) => /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_]{1,23}$/.test(nick)),
    'ник — буквы, цифры и подчёркивание, без пробелов',
    sample.slice(0, 5),
  )
  check(
    sample.every((nick) => !nick.includes('.')),
    'без инициалов с точкой — так в сети не подписываются',
  )

  /*
   * Список из одной только латиницы читался так же однообразно, как читались
   * «Максим Б.»: сразу видно один генератор. Живые люди подписываются
   * по-разному, поэтому проверяем, что в списке есть и то, и другое.
   */
  const cyrillic = sample.filter((nick) => /[А-Яа-яЁё]/.test(nick))
  const latin = sample.filter((nick) => /^[A-Za-z]/.test(nick))
  check(
    cyrillic.length >= 30 && latin.length >= 60,
    'в списке вперемешку русские имена и ники латиницей',
    `${cyrillic.length} русских, ${latin.length} латиницей из ${sample.length}`,
  )
  check(
    new Set(sample).size > sample.length * 0.5,
    'ники не повторяются толпой: генератор даёт разнообразие',
    `${new Set(sample).size} разных из ${sample.length}`,
  )

  const bots = await ensureBots(30)
  check(bots.length >= 30, 'ботов хватает на людный список', bots.length)
  check(
    bots.every((bot) => !bot.nickname.includes(' ') && !bot.nickname.includes('.')),
    'у ботов ники того же вида, что предлагаются игрокам',
    bots.slice(0, 4).map((b) => b.nickname),
  )

  console.log('\nСписок боёв')

  const settings = await getBotSettings()
  check(settings.openMatches >= 30, 'в настройках заказан людный список', settings.openMatches)

  await topUpOpenMatches(settings)

  const lobby = await query<{ bet_amount: string; rounds_total: number }>(
    `SELECT m.bet_amount::text, m.rounds_total
       FROM matches m
       JOIN users u ON u.id = m.player1_id
      WHERE m.status = 'searching' AND m.player2_id IS NULL AND u.is_bot = TRUE`,
  )
  check(
    lobby.length >= Math.min(settings.openMatches, 30),
    'открытых боёв столько, сколько заказано',
    lobby.length,
  )

  /*
   * Ставка обязана быть той, которую человек может нажать. Бой на 175 медяков
   * не совпадёт ни с чьим выбором — такой кнопки в приложении нет, и строка
   * в списке становится украшением, а не боем.
   */
  const PRESETS = new Set([25, 50, 100, 250, 500])
  check(
    lobby.every((row) => PRESETS.has(Number(row.bet_amount))),
    'ставки в списке — только те, что можно выбрать в приложении',
    [...new Set(lobby.map((r) => Number(r.bet_amount)))].sort((a, b) => a - b),
  )
  check(
    new Set(lobby.map((r) => r.rounds_total)).size >= 3,
    'раунды в списке разные, а не один вариант на всех',
    [...new Set(lobby.map((r) => r.rounds_total))],
  )

  /*
   * Ротация не должна убирать бой из-под пальца. Все бои сейчас свежие —
   * значит, не тронуть должна ни одного.
   */
  const churned = await churnOpenMatches(settings)
  check(churned === 0, 'только что открытые бои не исчезают под рукой', churned)

  console.log('\nПодбор соперника')

  const auth = await app.inject({
    method: 'POST',
    url: '/api/auth/dev',
    payload: { telegramId: 960_000_000 + stamp, name: 'Одинокий игрок' },
  })
  const token = auth.json().token as string
  const userId = auth.json().user.id as number

  /*
   * Держим соединение открытым: бот заходит только к тому, кто у экрана.
   * Без этого проверка ловила бы не подбор, а собственную невнимательность —
   * игрока, который закрыл приложение, спасать не от чего.
   */
  const socket = new WebSocket(`${wsUrl}?token=${token}`)
  await new Promise((resolve) => socket.on('open', resolve))
  await new Promise((r) => setTimeout(r, 300))

  /*
   * Условия нарочно неудобные: ставка и число раундов, которые вряд ли
   * совпадут с чужим открытым боем. Именно на таких человек и застревал.
   */
  const created = await app.inject({
    method: 'POST',
    url: '/api/matches',
    headers: { authorization: `Bearer ${token}` },
    payload: { mode: 'random', bet: 175, rounds: 7 },
  })
  check(created.statusCode === 200, 'бой создан и ждёт соперника', created.body.slice(0, 120))
  const matchId = (created.json().match as { id: number }).id

  const startedAt = Date.now()
  let joinedAfterMs = -1

  while (Date.now() - startedAt < PROMISE_MS + 3000) {
    const row = await queryOne<{ status: string; player2_id: number | null }>(
      'SELECT status, player2_id FROM matches WHERE id = $1',
      [matchId],
    )
    if (row?.player2_id !== null && row?.player2_id !== undefined) {
      joinedAfterMs = Date.now() - startedAt
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  check(joinedAfterMs >= 0, 'соперник нашёлся, а не «ищем вечно»')
  check(
    joinedAfterMs >= 0 && joinedAfterMs <= PROMISE_MS,
    `уложились в обещанные десять секунд`,
    `${(joinedAfterMs / 1000).toFixed(1)} с`,
  )

  const match = await queryOne<{ status: string; player2_id: number }>(
    'SELECT status, player2_id FROM matches WHERE id = $1',
    [matchId],
  )
  check(match?.status === 'active', 'бой именно начался, а не просто занял место', match?.status)

  const opponent = await queryOne<{ is_bot: boolean; nickname: string; coins_balance: string }>(
    'SELECT is_bot, nickname, coins_balance::text FROM users WHERE id = $1',
    [match!.player2_id],
  )
  check(opponent?.is_bot === true, 'в бой вошёл бот — живых сейчас нет')
  check(
    !!opponent && !opponent.nickname.includes(' '),
    'соперник подписан как обычный игрок, а не как бот',
    opponent?.nickname,
  )

  /*
   * Ставка должна быть списана с обоих: бот играет по-настоящему, иначе
   * медяки печатались бы из воздуха.
   */
  const stakes = await query<{ user_id: number; amount: string }>(
    `SELECT user_id, amount::text FROM transactions
      WHERE type = 'bet_hold' AND match_id = $1`,
    [matchId],
  )
  check(stakes.length === 2, 'ставка удержана у обоих игроков', stakes.length)
  check(
    stakes.every((s) => Number(s.amount) === -175),
    'удержано ровно столько, сколько выбрал человек',
    stakes.map((s) => s.amount),
  )
  check(
    stakes.some((s) => s.user_id === userId) && stakes.some((s) => s.user_id === match!.player2_id),
    'списано именно с участников боя',
  )

  socket.close()
  await app.close()
  await closePool()
  await closeRedis()

  console.log(`\nИтог: ${passed} прошло, ${failed} не прошло`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
