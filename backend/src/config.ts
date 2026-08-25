import { z } from 'zod'

/**
 * Переменные окружения. Проверяются на старте: если чего-то не хватает,
 * приложение падает сразу с понятным сообщением, а не через час в проде.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  REDIS_URL: z.string().min(1, 'REDIS_URL обязателен'),

  /**
   * Токен бота из BotFather. Нужен для проверки подписи initData —
   * без него авторизация Telegram работать не может.
   * На первом этапе допускаем пустое значение: сервер поднимается,
   * но маршруты авторизации откажут явной ошибкой.
   */
  TELEGRAM_BOT_TOKEN: z.string().default(''),

  /** Секрет для подписи сессионных кук админки. */
  ADMIN_SESSION_SECRET: z.string().min(32).default('development-secret-change-me-please-32+'),

  /** Секрет для подписи сессионных токенов игроков. */
  AUTH_TOKEN_SECRET: z.string().min(32).default('development-auth-secret-change-me-32+'),

  /**
   * Папка со сборкой Mini App. Если задана, сервер отдаёт приложение сам —
   * тогда фронтенд и API живут на одном адресе, и для проверки через туннель
   * достаточно одной ссылки.
   */
  FRONTEND_DIST: z.string().optional(),

  /** Разрешённые источники запросов. Через запятую. */
  CORS_ORIGINS: z.string().default('*'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`Неверная конфигурация окружения:\n${problems}`)
  process.exit(1)
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS === '*' ? true : parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
}

export type Config = typeof config
