import { createHash, createHmac } from 'node:crypto'
import { buildServer } from '../server.js'
import { config } from '../config.js'
import { pool, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'
import { ensureAdminsFromEnv } from '../admin/auth.js'

/**
 * Проверка этапа 5: админ-панель.
 *
 * Панель распоряжается балансами игроков, поэтому проверяется не только «всё
 * ли рисуется», но и то, что чужой внутрь не попадёт, а каждое изменение
 * оставляет след в журнале.
 *
 * Вход подделывается ровно так, как его присылает Telegram: те же поля, та же
 * схема подписи. Отличие только в том, что токен бота здесь тестовый.
 *
 * Запуск: npm run verify:stage5
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

/** Подпись виджета входа Telegram: ключ — SHA-256 от токена бота. */
function signLogin(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
  const secret = createHash('sha256').update(botToken).digest()
  return createHmac('sha256', secret).update(dataCheckString).digest('hex')
}

function loginQuery(telegramId: number, botToken: string, name = 'Владелец'): string {
  const fields: Record<string, string> = {
    id: String(telegramId),
    first_name: name,
    auth_date: String(Math.floor(Date.now() / 1000)),
  }
  const hash = signLogin(fields, botToken)
  const params = new URLSearchParams({ ...fields, hash })
  return params.toString()
}

async function main(): Promise<void> {
  await connectRedis()

  const app = await buildServer()
  const botToken = config.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.error('Для проверки нужен TELEGRAM_BOT_TOKEN в backend/.env')
    process.exit(1)
  }

  const adminTelegramId = config.adminTelegramIds[0]
  if (!adminTelegramId) {
    console.error('Для проверки нужен ADMIN_TELEGRAM_IDS в backend/.env')
    process.exit(1)
  }

  await ensureAdminsFromEnv()

  let cookie = ''

  async function get(url: string, withCookie = true) {
    return app.inject({
      method: 'GET',
      url,
      headers: withCookie && cookie ? { cookie } : {},
    })
  }

  async function post(url: string, payload: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url,
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams(payload).toString(),
    })
  }

  try {
    // ─── Доступ ──────────────────────────────────────────────────────────────
    section('Кого пускать')

    const anonymous = await get('/admin', false)
    check(
      anonymous.statusCode === 302 && anonymous.headers.location === '/admin/login',
      'без входа панель не открывается',
      { code: anonymous.statusCode, to: anonymous.headers.location },
    )

    const loginPage = await get('/admin/login', false)
    check(loginPage.statusCode === 200, 'страница входа открывается')
    check(
      loginPage.body.includes('telegram-widget') || loginPage.body.includes('BOT_USERNAME'),
      'на странице входа есть кнопка Telegram',
    )

    // Подпись правильная, но человек не в списке админов
    const stranger = await get(`/admin/login/telegram?${loginQuery(555_000_111, botToken)}`, false)
    check(
      stranger.statusCode === 302 && (stranger.headers.location as string).includes('id=555000111'),
      'чужой с настоящей подписью внутрь не попадает',
      { to: stranger.headers.location },
    )

    // Подпись подделана
    const forgedQuery = loginQuery(adminTelegramId, 'совсем-не-тот-токен')
    const forged = await get(`/admin/login/telegram?${forgedQuery}`, false)
    check(
      forged.statusCode === 302 && (forged.headers.location as string).includes('error'),
      'поддельная подпись отклоняется',
      { to: forged.headers.location },
    )

    const noSession = await get('/admin/players', false)
    check(noSession.statusCode === 302, 'внутренние страницы тоже закрыты')

    // Настоящий вход
    const login = await get(`/admin/login/telegram?${loginQuery(adminTelegramId, botToken)}`, false)
    const setCookie = login.headers['set-cookie']
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
    cookie = raw ? raw.split(';')[0] : ''
    check(
      login.statusCode === 302 && login.headers.location === '/admin' && cookie.length > 0,
      'владелец входит и получает сессию',
      { to: login.headers.location },
    )

    const loginAudit = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM admin_audit WHERE action = 'login'`,
    )
    check(Number(loginAudit?.count) > 0, 'вход записан в журнал действий')

    // ─── Страницы ────────────────────────────────────────────────────────────
    section('Разделы')

    const pages: [string, string, string][] = [
      ['/admin', 'Сводка', 'Игроков всего'],
      ['/admin/players', 'Игроки', 'Найти'],
      ['/admin/matches', 'Матчи', 'Состояние'],
      ['/admin/transactions', 'Операции', 'журнал движений'],
      ['/admin/funnel', 'Поведение', 'Путь новичка'],
      ['/admin/config', 'Экономика', 'Параметры экономики'],
      ['/admin/audit', 'Журнал', 'Журнал действий'],
    ]

    for (const [url, label, marker] of pages) {
      const response = await get(url)
      check(
        response.statusCode === 200 && response.body.includes(marker),
        `${label} открывается`,
        { code: response.statusCode },
      )
    }

    // ─── Игрок ───────────────────────────────────────────────────────────────
    section('Карточка игрока')

    const someone = await queryOne<{ id: number; nickname: string; coins_balance: number }>(
      'SELECT id, nickname, coins_balance FROM users ORDER BY id LIMIT 1',
    )
    if (!someone) {
      console.log('  нет игроков в базе — сначала запустите verify:stage4')
      process.exit(1)
    }

    const cardPage = await get(`/admin/players/${someone.id}`)
    check(
      cardPage.statusCode === 200 && cardPage.body.includes('Изменить баланс'),
      'карточка игрока открывается',
    )
    check(
      cardPage.body.includes('Баланс сходится с журналом'),
      'на карточке видно, что баланс сходится с журналом',
    )

    const search = await get(`/admin/players?search=${encodeURIComponent(someone.nickname)}`)
    check(search.body.includes(someone.nickname), 'поиск находит игрока по имени')

    // Правка баланса
    const before = someone.coins_balance
    const adjust = await post(`/admin/players/${someone.id}/balance`, {
      amount: '150',
      comment: 'проверка админки',
    })
    const after = await queryOne<{ coins_balance: number }>(
      'SELECT coins_balance FROM users WHERE id = $1',
      [someone.id],
    )
    check(adjust.statusCode === 302, 'форма правки баланса принимает данные')
    check(
      Number(after?.coins_balance) === Number(before) + 150,
      'баланс изменился ровно на указанную сумму',
      { before, after: after?.coins_balance },
    )

    const adjustTx = await queryOne<{ type: string; comment: string; admin_id: number }>(
      `SELECT type, comment, admin_id FROM transactions
        WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [someone.id],
    )
    check(
      adjustTx?.type === 'admin_adjustment' && adjustTx.comment === 'проверка админки',
      'правка прошла через журнал операций, а не мимо него',
      adjustTx,
    )
    check(adjustTx?.admin_id !== null, 'в операции записано, какой администратор её провёл')

    const adjustAudit = await queryOne<{ before: unknown; after: unknown }>(
      `SELECT before, after FROM admin_audit
        WHERE action = 'balance_adjust' ORDER BY id DESC LIMIT 1`,
    )
    check(adjustAudit !== null, 'правка баланса попала в журнал действий')

    const ledger = await queryOne<{ balance: string; sum: string }>(
      `SELECT u.coins_balance::text AS balance,
              (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE user_id = u.id)::text AS sum
         FROM users u WHERE u.id = $1`,
      [someone.id],
    )
    check(
      ledger?.balance === ledger?.sum,
      'после правки баланс по-прежнему сходится с журналом',
      ledger,
    )

    // Вернём как было, чтобы проверка не портила данные
    await post(`/admin/players/${someone.id}/balance`, {
      amount: '-150',
      comment: 'откат проверки',
    })

    // Блокировка
    await post(`/admin/players/${someone.id}/ban`, { action: 'ban', reason: 'проверка' })
    const banned = await queryOne<{ banned_at: string | null; ban_reason: string | null }>(
      'SELECT banned_at, ban_reason FROM users WHERE id = $1',
      [someone.id],
    )
    check(banned?.banned_at !== null && banned?.ban_reason === 'проверка', 'блокировка работает')

    await post(`/admin/players/${someone.id}/ban`, { action: 'unban' })
    const unbanned = await queryOne<{ banned_at: string | null }>(
      'SELECT banned_at FROM users WHERE id = $1',
      [someone.id],
    )
    check(unbanned?.banned_at === null, 'разблокировка работает')

    const banAudit = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM admin_audit WHERE action IN ('player_ban', 'player_unban')`,
    )
    check(Number(banAudit?.count) >= 2, 'блокировка и разблокировка записаны в журнал')

    // ─── Экономика ───────────────────────────────────────────────────────────
    section('Параметры экономики')

    const beforeConfig = await queryOne<{ value: string }>(
      `SELECT value::text AS value FROM app_config WHERE key = 'daily_bonus'`,
    )

    await post('/admin/config', { key: 'daily_bonus', value: '33' })

    const afterConfig = await queryOne<{ value: string; updated_by: number | null }>(
      `SELECT value::text AS value, updated_by FROM app_config WHERE key = 'daily_bonus'`,
    )
    check(afterConfig?.value === '33', 'параметр сохранился', afterConfig)
    check(afterConfig?.updated_by !== null, 'записано, кто менял параметр')

    const apiConfig = await app.inject({ method: 'GET', url: '/api/config' })
    const economy = (apiConfig.json() as { economy: { dailyBonus: number } }).economy
    check(
      economy.dailyBonus === 33,
      'приложение сразу получает новое значение, без пересборки',
      economy.dailyBonus,
    )

    const badValue = await post('/admin/config', { key: 'daily_bonus', value: 'сто' })
    const afterBad = await queryOne<{ value: string }>(
      `SELECT value::text AS value FROM app_config WHERE key = 'daily_bonus'`,
    )
    check(
      badValue.statusCode === 302 && afterBad?.value === '33',
      'мусор вместо числа не сохраняется',
      afterBad,
    )

    const negative = await post('/admin/config', { key: 'daily_bonus', value: '-10' })
    const afterNegative = await queryOne<{ value: string }>(
      `SELECT value::text AS value FROM app_config WHERE key = 'daily_bonus'`,
    )
    check(
      negative.statusCode === 302 && afterNegative?.value === '33',
      'отрицательное значение не сохраняется',
    )

    // Возвращаем как было
    await post('/admin/config', { key: 'daily_bonus', value: String(Number(beforeConfig?.value)) })

    const configAudit = await queryOne<{ before: unknown; after: unknown }>(
      `SELECT before, after FROM admin_audit WHERE action = 'config_change' ORDER BY id DESC LIMIT 1`,
    )
    check(configAudit !== null, 'правка параметров записана в журнал')

    // ─── Матч ────────────────────────────────────────────────────────────────
    section('Разбор матча')

    const anyMatch = await queryOne<{ id: number }>(
      `SELECT id FROM matches WHERE status = 'finished' ORDER BY id DESC LIMIT 1`,
    )
    if (anyMatch) {
      const matchPage = await get(`/admin/matches/${anyMatch.id}`)
      check(matchPage.statusCode === 200 && matchPage.body.includes('Раунды'), 'матч открывается')
      check(
        /✊|✌️|✋/.test(matchPage.body),
        'видно, кто какую фигуру показал в каждом раунде',
      )
      check(matchPage.body.includes(' с</td>') || / с /.test(matchPage.body), 'видно время на ход')
    } else {
      console.log('  нет сыгранных матчей — раздел не проверен')
    }

    // ─── Выход ───────────────────────────────────────────────────────────────
    section('Выход')

    const logout = await get('/admin/logout')
    const cleared = logout.headers['set-cookie']
    const clearedRaw = Array.isArray(cleared) ? cleared[0] : cleared
    check(
      logout.statusCode === 302 && (clearedRaw ?? '').includes('Max-Age=0'),
      'выход стирает сессию',
    )

    cookie = clearedRaw ? clearedRaw.split(';')[0] : ''
    const afterLogout = await get('/admin')
    check(afterLogout.statusCode === 302, 'после выхода панель снова закрыта')
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
