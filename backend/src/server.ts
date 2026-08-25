import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { closePool, pool } from './db/client.js'
import { closeRedis, connectRedis } from './lib/redis.js'
import { healthRoutes } from './routes/health.js'

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.isProduction ? undefined : { target: 'pino-pretty' },
    },
    // Telegram и рекламные сети шлют вебхуки с их собственными заголовками
    trustProxy: true,
  })

  await app.register(cors, { origin: config.corsOrigins, credentials: true })

  await app.register(healthRoutes)

  app.get('/', async () => ({
    name: 'knb-backend',
    status: 'ok',
    // TODO(этап 2): здесь появится GET /api/config с параметрами экономики
  }))

  return app
}

async function start(): Promise<void> {
  const app = await buildServer()

  try {
    await connectRedis()
    await pool.query('SELECT 1')
  } catch (error) {
    app.log.error({ err: error }, 'Не удалось подключиться к хранилищам')
    process.exit(1)
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal}: останавливаюсь`)
    await app.close()
    await closeRedis()
    await closePool()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: config.PORT, host: config.HOST })
}

const isDirectRun = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')
if (isDirectRun) {
  void start()
}
