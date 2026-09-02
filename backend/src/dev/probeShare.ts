/*
 * Что на самом деле отвечает /api/matches/:id/share.
 *
 * На экране приложение показывало «сервер не ответил» — под этой фразой
 * прячется и отказ в доступе, и падение, и сон бесплатного сервера.
 * Здесь мы зовём тот же маршрут напрямую и печатаем код и тело ответа.
 *
 * Запуск: npm run probe:share
 */

import { buildServer } from '../server.js'
import { closePool } from '../db/client.js'
import { closeRedis } from '../lib/redis.js'

async function main(): Promise<void> {
  const app = await buildServer()
  const stamp = Date.now() % 1_000_000

  const auth = await app.inject({
    method: 'POST',
    url: '/api/auth/dev',
    payload: { telegramId: 970_000_000 + stamp, name: 'Хозяин' },
  })
  const token = auth.json().token as string
  console.log('вход:', auth.statusCode)

  const created = await app.inject({
    method: 'POST',
    url: '/api/matches',
    headers: { authorization: `Bearer ${token}` },
    payload: { mode: 'friend', bet: 100, rounds: 3, condition: 'проигравший отжимается 10 раз' },
  })
  console.log('создание матча:', created.statusCode, created.body.slice(0, 200))
  const matchId = (created.json().match as { id: number }).id

  const share = await app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/share`,
    headers: { authorization: `Bearer ${token}` },
  })
  console.log('\nПОДГОТОВКА СООБЩЕНИЯ')
  console.log('  код:', share.statusCode)
  console.log('  тело:', share.body)

  // Чужой матч: так маршрут отвечает тому, кто не хозяин приглашения.
  const other = await app.inject({
    method: 'POST',
    url: '/api/auth/dev',
    payload: { telegramId: 971_000_000 + stamp, name: 'Чужой' },
  })
  const foreign = await app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/share`,
    headers: { authorization: `Bearer ${other.json().token}` },
  })
  console.log('\nЧУЖОЙ ПРОСИТ ТО ЖЕ')
  console.log('  код:', foreign.statusCode, foreign.body)

  await app.close()
  await closePool()
  await closeRedis()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
