import type { FastifyInstance } from 'fastify'
import { renderLegal, type LegalDoc, type LegalLang } from '../legal/documents.js'

/**
 * Условия использования и политика конфиденциальности.
 *
 * Отдаются с того же адреса, что и само приложение: одна ссылка, никаких
 * посторонних сайтов, ничего не сломается от того, что где-то не продлили
 * домен. Открываются в обычном браузере Telegram — не внутри игры, чтобы
 * человек не терял бой, решив почитать правила.
 *
 * Без авторизации: прочитать условия должен мочь и тот, кто ещё не вошёл, —
 * он как раз и решает, входить ли.
 */
export async function legalRoutes(app: FastifyInstance): Promise<void> {
  const send = (doc: LegalDoc) =>
    async (
      request: { query?: unknown },
      reply: { type: (t: string) => { send: (body: string) => unknown } },
    ) => {
      const query = (request.query ?? {}) as { lang?: string }
      const lang: LegalLang = query.lang === 'en' ? 'en' : 'ru'
      return reply.type('text/html; charset=utf-8').send(renderLegal(doc, lang))
    }

  app.get('/legal/terms', send('terms'))
  app.get('/legal/privacy', send('privacy'))
}
