import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { closePool, pool } from './db/client.js'
import { closeRedis, connectRedis } from './lib/redis.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { meRoutes } from './routes/me.js'
import { configRoutes } from './routes/config.js'
import { eventsRoutes } from './routes/events.js'
import { matchRoutes } from './routes/matches.js'
import { socketRoutes, recoverActiveMatches } from './ws/socket.js'
import { adminRoutes } from './admin/routes.js'
import { ensureAdminsFromEnv } from './admin/auth.js'

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.isProduction ? undefined : { target: 'pino-pretty' },
    },
    trustProxy: true,
  })

  await app.register(cors, { origin: config.corsOrigins, credentials: true })

  await app.register(healthRoutes)
  await app.register(configRoutes)
  await app.register(authRoutes)
  await app.register(meRoutes)
  await app.register(eventsRoutes)
  await app.register(matchRoutes)
  await app.register(socketRoutes)
  await app.register(adminRoutes)

  /*
   * Отдача самого приложения.
   *
   * Когда задан FRONTEND_DIST, сервер раздаёт собранный Mini App с того же
   * адреса, что и API. Для проверки через туннель это важно: один адрес,
   * одна ссылка в BotFather, никаких запретов между разными источниками.
   */
  const distPath = config.FRONTEND_DIST ? resolve(process.cwd(), config.FRONTEND_DIST) : null

  if (distPath && existsSync(distPath)) {
    await app.register(fastifyStatic, { root: distPath, wildcard: false })

    // Любой неизвестный путь отдаёт приложение — иначе обновление страницы
    // на внутреннем экране вернёт 404.
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/api') ||
        request.url.startsWith('/health') ||
        request.url.startsWith('/admin')
      ) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.sendFile('index.html')
    })

    app.log.info(`Mini App отдаётся из ${distPath}`)
  } else {
    app.get('/', async () => ({
      name: 'knb-backend',
      status: 'ok',
      hint: distPath
        ? `сборка приложения не найдена в ${distPath} — выполните npm run build во frontend`
        : 'FRONTEND_DIST не задан: сервер отдаёт только API',
    }))
    if (distPath) app.log.warn(`FRONTEND_DIST указывает на ${distPath}, но папки нет`)
  }

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

  try {
    const admins = await ensureAdminsFromEnv()
    if (admins > 0) app.log.info(`заведено администраторов: ${admins}`)
  } catch (error) {
    app.log.error({ err: error }, 'не удалось завести администраторов из настроек')
  }

  // Часы раундов живут в памяти процесса: после перезапуска поднимаем их заново.
  try {
    const restored = await recoverActiveMatches()
    if (restored > 0) app.log.info(`восстановлены часы ${restored} идущих матчей`)
  } catch (error) {
    app.log.error({ err: error }, 'не удалось восстановить идущие матчи')
  }

  if (!config.TELEGRAM_BOT_TOKEN) {
    app.log.warn('TELEGRAM_BOT_TOKEN не задан — вход через Telegram работать не будет')
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
