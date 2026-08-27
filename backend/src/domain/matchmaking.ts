import { query } from '../db/client.js'
import { isOnline } from './presence.js'
import {
  createMatch,
  startMatch,
  MatchError,
  type MatchRow,
  type RoundRow,
} from './match.js'

/**
 * Подбор соперника.
 *
 * Ожидающий игрок — это не невидимая заявка в очереди, а настоящая строка
 * матча со статусом «ищет соперника». Так открытый бой видно в общем списке,
 * и войти в него можно двумя способами: нажать «Найти бой» и выбрать глазами
 * или встать в подбор и получить первого подходящего.
 *
 * Раньше очередь жила в Redis и была невидимой: игрок создавал бой, а второй
 * не мог его найти. Теперь источник правды один — таблица matches.
 */

const MAX_JOIN_ATTEMPTS = 5

export interface OpenMatch {
  id: number
  bet: number
  rounds: number
  condition: string | null
  createdAt: string
  host: { id: number; nickname: string; avatarId: string; rating: number }
}

export interface QueueResult {
  /** Соперник найден и матч уже начат. */
  matched: boolean
  match?: MatchRow
  round?: RoundRow
  /** Бой опубликован и ждёт соперника. */
  waiting?: { matchId: number; bet: number; rounds: number }
}

/**
 * Проверка «этот игрок всё ещё на связи» живёт отдельно: она нужна не только
 * подбору, но и списку друзей. Реализацию подставляет слой WebSocket.
 */
export { setLivenessCheck, type LivenessCheck } from './presence.js'

/** Открытые бои — то, что видит игрок на экране поиска. */
export async function listOpenMatches(
  viewerId: number,
  filter: { bet?: number; rounds?: number; limit?: number } = {},
): Promise<OpenMatch[]> {
  const conditions = ['m.status = \'searching\'', 'm.player2_id IS NULL', 'm.player1_id <> $1']
  const params: unknown[] = [viewerId]

  if (filter.bet !== undefined) {
    params.push(filter.bet)
    conditions.push(`m.bet_amount = $${params.length}`)
  }
  if (filter.rounds !== undefined) {
    params.push(filter.rounds)
    conditions.push(`m.rounds_total = $${params.length}`)
  }
  params.push(Math.min(filter.limit ?? 50, 100))

  const rows = await query<{
    id: number
    bet_amount: number
    rounds_total: number
    condition: string | null
    created_at: string
    host_id: number
    nickname: string
    avatar_id: string
    rating: number
  }>(
    `SELECT m.id, m.bet_amount, m.rounds_total, m.condition, m.created_at,
            u.id AS host_id, u.nickname, u.avatar_id, u.rating
       FROM matches m
       JOIN users u ON u.id = m.player1_id
      WHERE ${conditions.join(' AND ')}
        AND u.banned_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT $${params.length}`,
    params,
  )

  /*
   * Показываем только тех, кто действительно у экрана. Бой, чей создатель
   * закрыл приложение, в списке не нужен: нажатие по нему кончилось бы
   * ожиданием соперника, которого нет.
   */
  return rows
    .filter((row) => isOnline(row.host_id))
    .map((row) => ({
      id: row.id,
      bet: row.bet_amount,
      rounds: row.rounds_total,
      condition: row.condition,
      createdAt: row.created_at,
      host: {
        id: row.host_id,
        nickname: row.nickname,
        avatarId: row.avatar_id,
        rating: row.rating,
      },
    }))
}

/**
 * Встать в подбор: сначала пробуем войти в уже открытый бой с теми же
 * условиями, и только если такого нет — публикуем свой.
 */
export async function enqueue(userId: number, bet: number, rounds: number): Promise<QueueResult> {
  if (bet <= 0) {
    throw new MatchError('free_only_friend', 'бесплатно играть можно только с другом')
  }

  // Свои прошлые незакрытые заявки убираем: два открытых боя от одного
  // игрока в списке выглядели бы как два разных соперника.
  await cancelOpen(userId)

  const candidates = await listOpenMatches(userId, { bet, rounds, limit: MAX_JOIN_ATTEMPTS })

  for (const candidate of candidates) {
    try {
      const started = await startMatch(candidate.id, userId)
      return { matched: true, match: started.match, round: started.round }
    } catch (error) {
      /*
       * Кто-то успел войти раньше, у хозяина боя не хватило медяков или его
       * забанили — пробуем следующий бой из списка.
       */
      if (error instanceof MatchError) continue
      throw error
    }
  }

  const match = await createMatch({ mode: 'random', player1Id: userId, bet, rounds })
  return { matched: false, waiting: { matchId: match.id, bet, rounds } }
}

/** Войти в конкретный открытый бой — по нажатию в списке. */
export async function joinOpen(
  matchId: number,
  userId: number,
): Promise<{ match: MatchRow; round: RoundRow }> {
  return startMatch(matchId, userId)
}

/**
 * Снять свои заявки: игрок вышел из подбора или закрыл приложение.
 * Ставка при этом не задета — она списывается только в момент старта.
 */
export async function cancelOpen(userId: number): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE matches
        SET status = 'cancelled', finished_at = now()
      WHERE player1_id = $1
        AND player2_id IS NULL
        AND status = 'searching'
      RETURNING id`,
    [userId],
  )
  return rows.length
}

/** Совместимость с прежним именем: выход из подбора. */
export async function dequeue(userId: number): Promise<boolean> {
  return (await cancelOpen(userId)) > 0
}
