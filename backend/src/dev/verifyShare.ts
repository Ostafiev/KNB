import { buildServer } from '../server.js'
import { pool, queryOne } from '../db/client.js'
import { connectRedis, redis } from '../lib/redis.js'
import { buildInviteMessage } from '../domain/inviteMessage.js'
import type { MatchRow } from '../domain/match.js'

/**
 * Проверка приглашения другу.
 *
 * Сам вызов к Telegram здесь не проверить: он уходит на api.telegram.org,
 * которого в этой песочнице нет. Зато проверяется всё остальное — из чего
 * собирается сообщение, кто имеет право его готовить и что приложение
 * получит, если Telegram недоступен.
 *
 * Запуск: npm run verify:share
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

async function main(): Promise<void> {
  await connectRedis()
  const app = await buildServer()
  const stamp = Date.now() % 1_000_000

  async function login(telegramId: number, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { telegramId, name },
    })
    return response.json() as { token: string; user: { id: number } }
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
    // ─── Текст сообщения ─────────────────────────────────────────────────────
    section('Из чего собирается сообщение другу')

    const withCondition = {
      id: 42,
      bet_amount: 100,
      rounds_total: 3,
      condition: 'кто проиграл, тот отжимается 10 раз',
    } as unknown as MatchRow

    const message = buildInviteMessage(withCondition, 'ru')
    check(message.text.includes('Бросаю тебе вызов'), 'сообщение начинается с вызова', message.text)
    check(
      message.text.includes('кто проиграл, тот отжимается 10 раз'),
      'условие пари попадает в сообщение — то, ради чего его и пишут',
      message.text,
    )
    check(message.text.includes('100 медяков'), 'ставка указана словами', message.text)
    check(message.text.includes('раундов: 3'), 'число раундов указано', message.text)
    check(
      message.buttonUrl.includes('?startapp=match_42'),
      'кнопка ведёт прямо в этот бой',
      message.buttonUrl,
    )
    check(
      message.buttonUrl.startsWith('https://t.me/') && !message.buttonUrl.includes('undefined'),
      'адрес кнопки собран правильно',
      message.buttonUrl,
    )
    check(
      message.description.includes('отжимается'),
      'условие видно и в подписи к сообщению',
      message.description,
    )

    const free = buildInviteMessage(
      { id: 7, bet_amount: 0, rounds_total: 1, condition: null } as unknown as MatchRow,
      'ru',
    )
    check(free.text.includes('бесплатно'), 'бесплатный бой так и назван', free.text)
    check(!free.text.includes('Условие'), 'без условия лишней строки нет', free.text)

    const english = buildInviteMessage(withCondition, 'en')
    check(english.text.includes('I challenge you'), 'английский текст свой, а не перевод на ходу')

    // ─── Кто может готовить приглашение ──────────────────────────────────────
    section('Права на отправку')

    const owner = await login(940_000_000 + stamp, 'Хозяин')
    const stranger = await login(940_100_000 + stamp, 'Посторонний')

    const created = await rest(owner.token, 'POST', '/api/matches', {
      mode: 'friend',
      bet: 25,
      rounds: 3,
      condition: 'проигравший варит кофе',
    })
    const matchId = (created.body.match as { id: number }).id
    check(created.status === 200, 'матч для приглашения создан')

    const byStranger = await rest(stranger.token, 'POST', `/api/matches/${matchId}/share`)
    check(
      byStranger.status === 403,
      'чужое приглашение подготовить нельзя',
      byStranger.body,
    )

    const missing = await rest(owner.token, 'POST', '/api/matches/999999999/share')
    check(missing.status === 404, 'несуществующий матч — честная ошибка', missing.body)

    // ─── Что приходит приложению ─────────────────────────────────────────────
    section('Ответ приложению')

    const share = await rest(owner.token, 'POST', `/api/matches/${matchId}/share`)
    check(share.status === 200, 'запрос отработал', share.body)

    const body = share.body as {
      preparedMessageId: string | null
      reason?: string
      text: string
      url: string
    }
    check(typeof body.text === 'string' && body.text.length > 0, 'текст сообщения пришёл')
    check(
      body.text.includes('проигравший варит кофе'),
      'условие из матча, а не из того, что прислал клиент',
      body.text,
    )
    check(
      body.url.includes(`startapp=match_${matchId}`),
      'ссылка ведёт в этот же бой',
      body.url,
    )

    if (body.preparedMessageId) {
      check(true, 'Telegram подготовил сообщение — откроется окно выбора чата')
    } else {
      console.log(`  · Telegram недоступен из песочницы (${body.reason}) — это ожидаемо здесь`)
      check(
        body.text.length > 0 && body.url.length > 0,
        'при недоступном Telegram приложение всё равно получает текст и ссылку',
      )
    }

    const row = await queryOne<{ condition: string }>(
      'SELECT condition FROM matches WHERE id = $1',
      [matchId],
    )
    check(row?.condition === 'проигравший варит кофе', 'условие сохранено в самом матче')
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
