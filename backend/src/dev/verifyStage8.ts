import { buildServer } from '../server.js'
import { pool, query, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'
import { invalidateEconomyCache } from '../domain/appConfig.js'

/**
 * Проверка правок по пользовательскому пути.
 *
 * Здесь всё, что можно проверить машиной: стартовый баланс, ежедневный бонус,
 * отметка о знакомстве, состав списка друзей, имя бота в настройках.
 * Внешний вид (руки, замах, кнопки) проверяется глазами на снимках.
 *
 * Запуск: npm run verify:stage8
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
  invalidateEconomyCache()

  const app = await buildServer()
  const stamp = Date.now() % 1_000_000

  async function login(telegramId: number, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { telegramId, name },
    })
    return response.json() as {
      token: string
      user: {
        id: number
        balance: number
        nickname: string
        profileReady?: boolean
        consentAccepted: boolean
        dailyBonusAvailable: boolean
      }
    }
  }

  async function rest(
    token: string,
    method: 'GET' | 'POST' | 'PATCH',
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
    // ─── Настройки приложения ────────────────────────────────────────────────
    section('Настройки, которые приложение получает при входе')

    const config = await app.inject({ method: 'GET', url: '/api/config' })
    const configBody = config.json() as { economy: { minBet: number }; botUsername?: string }
    check(config.statusCode === 200, 'настройки отдаются')
    check(
      typeof configBody.botUsername === 'string' && configBody.botUsername.length > 0,
      'имя бота приходит с сервера, а не вшито в сборку',
      configBody.botUsername,
    )
    check(
      !configBody.botUsername?.startsWith('@'),
      'имя бота без собачки — иначе ссылка сломается',
      configBody.botUsername,
    )

    // ─── Стартовый баланс ────────────────────────────────────────────────────
    section('Новый игрок')

    const newbie = await login(930_000_000 + stamp, 'Новичок')
    check(newbie.user.balance === 1000, 'на старте тысяча медяков', newbie.user.balance)
    check(
      (await balanceOf(newbie.user.id)) === (await ledgerSum(newbie.user.id)),
      'стартовые медяки проведены через журнал операций',
    )
    check(newbie.user.profileReady === false, 'знакомство ещё не пройдено — имя спросят')
    check(newbie.user.consentAccepted === false, 'согласие ещё не дано')

    // ─── Знакомство ──────────────────────────────────────────────────────────
    section('Выбор имени при первом входе')

    const renamed = await rest(newbie.token, 'PATCH', '/api/me', { nickname: 'Тень' })
    check(
      (renamed.body.user as { nickname: string }).nickname === 'Тень',
      'игрок может назваться как хочет',
      renamed.body.user,
    )

    const ready = await rest(newbie.token, 'POST', '/api/me/profile-ready')
    check(
      (ready.body.user as { profileReady: boolean }).profileReady === true,
      'знакомство отмечено на сервере',
    )

    const again = await login(930_000_000 + stamp, 'Новичок')
    check(
      again.user.profileReady === true && again.user.nickname === 'Тень',
      'при следующем входе имя не спрашивают заново и оно сохранилось',
      again.user,
    )

    // ─── Ежедневный бонус ────────────────────────────────────────────────────
    section('Ежедневный бонус')

    const before = await balanceOf(newbie.user.id)
    const claim = await rest(newbie.token, 'POST', '/api/me/daily-bonus')
    const claimBody = claim.body as { granted: boolean; amount: number; balance: number }
    check(claimBody.granted === true, 'бонус выдан', claimBody)
    check(claimBody.amount > 0, 'сумма бонуса не нулевая', claimBody.amount)
    check(
      (await balanceOf(newbie.user.id)) === before + claimBody.amount,
      'медяки действительно начислены на баланс',
      { before, after: await balanceOf(newbie.user.id), amount: claimBody.amount },
    )
    check(
      (await balanceOf(newbie.user.id)) === (await ledgerSum(newbie.user.id)),
      'начисление прошло через журнал операций',
    )

    const afterClaim = await balanceOf(newbie.user.id)
    const second = await rest(newbie.token, 'POST', '/api/me/daily-bonus')
    check(
      (second.body as { granted: boolean }).granted === false,
      'второй раз за сутки бонус не выдаётся',
    )
    check(
      (await balanceOf(newbie.user.id)) === afterClaim,
      'повторная попытка не меняет баланс',
    )

    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions
        WHERE user_id = $1 AND type = 'daily_bonus'`,
      [newbie.user.id],
    )
    check(Number(rows[0]?.count) === 1, 'в журнале ровно одно начисление за день', rows[0])

    // ─── Кто попадает в друзья ───────────────────────────────────────────────
    section('Друзья — только по ссылкам')

    const host = await login(930_100_000 + stamp, 'Хозяин')
    const rival = await login(930_200_000 + stamp, 'Случайный соперник')
    const invited = await login(930_300_000 + stamp, 'Пришёл по ссылке')

    // Сыгранный матч со случайным соперником — в друзья он попасть не должен.
    const match = await queryOne<{ id: number }>(
      `INSERT INTO matches (mode, status, player1_id, player2_id, bet_amount, rounds_total,
                            winner_id, started_at, finished_at, finish_reason)
       VALUES ('random', 'finished', $1, $2, 25, 1, $1, now(), now(), 'played')
       RETURNING id`,
      [host.user.id, rival.user.id],
    )
    check(match !== null, 'подготовлен сыгранный матч со случайным соперником')

    await query(
      `INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)
       ON CONFLICT (referred_id) DO NOTHING`,
      [host.user.id, invited.user.id],
    )

    const friends = (
      (await rest(host.token, 'GET', '/api/me/friends')).body as {
        friends: { id: number; source: string }[]
      }
    ).friends

    check(
      friends.some((f) => f.id === invited.user.id),
      'пришедший по ссылке — друг',
      friends,
    )
    check(
      !friends.some((f) => f.id === rival.user.id),
      'случайный соперник из подбора в друзья не попадает',
      friends,
    )
    check(
      friends.every((f) => f.source === 'invited' || f.source === 'inviter'),
      'других источников в списке нет',
      friends.map((f) => f.source),
    )
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
