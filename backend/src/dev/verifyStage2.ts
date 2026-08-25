/*
 * Сквозная проверка этапа 2.
 *
 * Поднимает сервер в памяти (без сети) и прогоняет полный путь игрока:
 * вход через Telegram, регистрация, бонусы, профиль, согласие, события.
 * Подпись initData собирается тестовым токеном бота — настоящий не нужен.
 *
 * Запуск: npm run verify:stage2
 */

import assert from 'node:assert/strict'
import { buildServer } from '../server.js'
import { buildInitData } from '../telegram/initData.js'
import { closePool, query, queryOne } from '../db/client.js'
import { closeRedis } from '../lib/redis.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
assert(BOT_TOKEN, 'для проверки нужен TELEGRAM_BOT_TOKEN (подойдёт любой тестовый)')

let passed = 0
let failed = 0

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (error) {
    console.log(`  ✗ ${name}`)
    console.log(`      ${(error as Error).message}`)
    failed++
  }
}

async function main(): Promise<void> {
  const app = await buildServer()
  // Уникальные идентификаторы, чтобы прогон не спотыкался о прошлые запуски
  const stamp = Date.now() % 1_000_000
  const aliceId = 900_000_000 + stamp
  const bobId = 910_000_000 + stamp

  console.log('\nВход через Telegram')

  let aliceToken = ''
  let aliceCode = ''

  await check('новый игрок регистрируется и получает 100 медяков', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: {
        initData: buildInitData(BOT_TOKEN!, {
          id: aliceId,
          first_name: 'Алиса',
          username: 'alice_test',
          language_code: 'ru',
        }),
      },
    })
    assert.equal(res.statusCode, 200, `код ответа ${res.statusCode}: ${res.body}`)
    const body = res.json()
    assert.equal(body.user.isNew, true, 'игрок должен быть новым')
    assert.equal(body.user.balance, 100, `баланс ${body.user.balance}, ожидали 100`)
    assert.equal(body.user.nickname, 'Алиса')
    assert.equal(body.user.language, 'ru', 'язык подтянулся из Telegram')
    assert.ok(body.token, 'должен вернуться токен')
    aliceToken = body.token
    aliceCode = body.user.referralCode
  })

  await check('повторный вход не создаёт второго игрока и не начисляет бонус ещё раз', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: {
        initData: buildInitData(BOT_TOKEN!, { id: aliceId, first_name: 'Алиса', language_code: 'ru' }),
      },
    })
    const body = res.json()
    assert.equal(body.user.isNew, false)
    assert.equal(body.user.balance, 100, 'бонус начислен повторно')
  })

  await check('подделанная подпись отклоняется', async () => {
    const good = buildInitData(BOT_TOKEN!, { id: aliceId, first_name: 'Алиса' })
    const tampered = good.replace(/id%22%3A\d+/, `id%22%3A${aliceId + 1}`)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: tampered },
    })
    assert.equal(res.statusCode, 401, 'подмена id должна быть отвергнута')
  })

  await check('подпись чужим токеном отклоняется', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: buildInitData('чужой:токен', { id: aliceId, first_name: 'Чужой' }) },
    })
    assert.equal(res.statusCode, 401)
  })

  await check('устаревшая подпись отклоняется', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: {
        initData: buildInitData(BOT_TOKEN!, { id: aliceId, first_name: 'Алиса' }, { authDate: old }),
      },
    })
    assert.equal(res.statusCode, 401)
    assert.equal(res.json().error, 'expired')
  })

  console.log('\nРефералы')

  await check('пришедший по ссылке получает 100 + 50 стартовых', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: {
        initData: buildInitData(
          BOT_TOKEN!,
          { id: bobId, first_name: 'Боб', language_code: 'en' },
          { startParam: `ref_${aliceCode}` },
        ),
      },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.user.balance, 150, `баланс ${body.user.balance}, ожидали 150`)
    assert.equal(body.user.language, 'en', 'английская локаль подтянулась')
  })

  await check('связь приглашения записана, бонус пригласившему пока не выплачен', async () => {
    const row = await queryOne<{ bonus_paid: boolean }>(
      `SELECT r.bonus_paid FROM referrals r
        JOIN users u ON u.id = r.referred_id
       WHERE u.telegram_id = $1`,
      [bobId],
    )
    assert.ok(row, 'запись о приглашении не найдена')
    assert.equal(row.bonus_paid, false, 'бонус должен ждать первого матча приглашённого')
  })

  console.log('\nПрофиль')

  const auth = { authorization: `Bearer ${aliceToken}` }

  await check('без токена профиль не отдаётся', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    assert.equal(res.statusCode, 401)
  })

  await check('испорченный токен отклоняется', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${aliceToken.slice(0, -3)}xyz` },
    })
    assert.equal(res.statusCode, 401)
  })

  await check('с токеном профиль отдаётся', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth })
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().user.nickname, 'Алиса')
  })

  await check('ник и настройки сохраняются', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth,
      payload: { nickname: 'Алиса Победитель', avatarId: 'fox', theme: 'light', soundEnabled: false },
    })
    assert.equal(res.statusCode, 200, res.body)
    const user = res.json().user
    assert.equal(user.nickname, 'Алиса Победитель')
    assert.equal(user.avatarId, 'fox')
    assert.equal(user.theme, 'light')
    assert.equal(user.soundEnabled, false)
  })

  await check('слишком короткий ник отклоняется', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth,
      payload: { nickname: 'я' },
    })
    assert.equal(res.statusCode, 400)
  })

  await check('несуществующий аватар отклоняется', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth,
      payload: { avatarId: 'единорог' },
    })
    assert.equal(res.statusCode, 400)
  })

  await check('согласие фиксируется на сервере', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/me', headers: auth })
    assert.equal(before.json().user.consentAccepted, false)

    const res = await app.inject({ method: 'POST', url: '/api/me/consent', headers: auth })
    assert.equal(res.json().user.consentAccepted, true)
  })

  console.log('\nЕжедневный бонус')

  await check('первый бонус за день начисляется', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/me/daily-bonus', headers: auth })
    const body = res.json()
    assert.equal(body.granted, true)
    assert.equal(body.amount, 20)
    assert.equal(body.balance, 120)
  })

  await check('второй бонус в тот же день не начисляется', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/me/daily-bonus', headers: auth })
    const body = res.json()
    assert.equal(body.granted, false)
    assert.equal(body.balance, 120, 'баланс не должен вырасти')
  })

  console.log('\nЖурнал и сверка')

  await check('история операций отдаётся', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/transactions', headers: auth })
    const types = res.json().transactions.map((t: { type: string }) => t.type)
    assert.ok(types.includes('signup_bonus'), 'нет записи о регистрационном бонусе')
    assert.ok(types.includes('daily_bonus'), 'нет записи о ежедневном бонусе')
  })

  await check('баланс сходится с суммой операций', async () => {
    const rows = await query<{ id: number; balance: string; ledger: string }>(
      `SELECT u.id, u.coins_balance::text AS balance,
              COALESCE(SUM(t.amount), 0)::text AS ledger
         FROM users u
         LEFT JOIN transactions t ON t.user_id = u.id
        WHERE u.telegram_id IN ($1, $2)
        GROUP BY u.id, u.coins_balance`,
      [aliceId, bobId],
    )
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.balance, row.ledger, `у игрока ${row.id} баланс ${row.balance} ≠ журнал ${row.ledger}`)
    }
  })

  console.log('\nПараметры экономики и события')

  await check('экономика отдаётся с сервера', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    const economy = res.json().economy
    assert.equal(economy.minBet, 25)
    assert.equal(economy.maxBet, 500)
    assert.equal(economy.signupBonus, 100)
    assert.equal(economy.dailyBonus, 20)
    assert.equal(economy.eloStart, 1000)
  })

  await check('события принимаются и привязываются к игроку', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: auth,
      payload: {
        events: [
          { name: 'app_open', props: { screen: 'splash' }, sessionId: 's1' },
          { name: 'bet_opened', props: { bet: 100 }, sessionId: 's1' },
        ],
      },
    })
    assert.equal(res.statusCode, 202)

    const rows = await query<{ name: string }>(
      `SELECT e.name FROM events e JOIN users u ON u.id = e.user_id
        WHERE u.telegram_id = $1 ORDER BY e.id`,
      [aliceId],
    )
    assert.deepEqual(rows.map((r) => r.name), ['app_open', 'bet_opened'])
  })

  await check('дневная активность отмечена', async () => {
    const row = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM daily_active_users d
         JOIN users u ON u.id = d.user_id
        WHERE u.telegram_id = $1 AND d.day = CURRENT_DATE`,
      [aliceId],
    )
    assert.equal(row?.count, '1')
  })

  await app.close()
  await closeRedis()
  await closePool()

  console.log(`\nИтог: ${passed} прошло, ${failed} не прошло\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
