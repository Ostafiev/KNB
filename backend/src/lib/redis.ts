import { Redis } from 'ioredis'
import { config } from '../config.js'

/**
 * Redis нужен для матчмейкинга (очередь подбора по рейтингу и ставке)
 * и кэша конфигурации экономики. Данные, которые нельзя терять,
 * живут в PostgreSQL, а не здесь.
 */
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('Ошибка Redis', err.message)
})

export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready' || redis.status === 'connecting') return
  await redis.connect()
}

export async function closeRedis(): Promise<void> {
  await redis.quit()
}
