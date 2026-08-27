import type { FastifyInstance } from 'fastify'
import { getEconomyConfig } from '../domain/appConfig.js'
import { config } from '../config.js'

/**
 * Параметры экономики для приложения.
 *
 * Раньше эти числа были зашиты во фронтенде; теперь приходят отсюда,
 * а редактируются в админке без пересборки (ЧАСТЬ 6, п.5).
 */
export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async (_request, reply) => {
    const economy = await getEconomyConfig()
    // Кэш на минуту: параметры меняются редко, а запрашиваются при каждом входе
    reply.header('Cache-Control', 'public, max-age=60')
    /*
     * Юзернейм бота отдаём с сервера, а не вшиваем в сборку приложения.
     * Вшитый, он зависел от того, дошла ли переменная до сборки образа;
     * не дошла — и ссылки-приглашения вели на несуществующего бота.
     */
    return { economy, botUsername: config.botUsername }
  })
}
