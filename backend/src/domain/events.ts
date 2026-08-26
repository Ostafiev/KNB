import { query } from '../db/client.js'

/**
 * Запись события со стороны сервера.
 *
 * События из приложения приходят через POST /api/events, но часть вещей
 * приложение не видит и видеть не должно: подозрительно быстрый ход,
 * выход из матча, срабатывание таймера. Пишем их здесь.
 *
 * Аналитика не имеет права ронять игру, поэтому ошибки глушатся.
 */
export async function recordEvent(
  userId: number | null,
  name: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query('INSERT INTO events (user_id, name, props) VALUES ($1, $2, $3)', [
      userId,
      name,
      JSON.stringify(props),
    ])
  } catch (error) {
    console.error('не удалось записать событие', name, error)
  }
}
