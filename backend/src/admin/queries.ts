import { query, queryOne } from '../db/client.js'

/**
 * Запросы админки.
 *
 * Все числа считаются из тех же таблиц, которыми живёт игра: отдельного
 * хранилища для отчётов нет, поэтому расхождения между «что показала панель»
 * и «что произошло на самом деле» быть не может.
 */

export interface Overview {
  players: number
  playersToday: number
  activeToday: number
  activeWeek: number
  matchesTotal: number
  matchesToday: number
  wageredToday: number
  coinsInPlay: number
  issued: number
  matchesLive: number
  searching: number
}

export async function overview(): Promise<Overview> {
  const row = await queryOne<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*) FROM users)::text AS players,
      (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE)::text AS players_today,
      (SELECT COUNT(*) FROM daily_active_users WHERE day = CURRENT_DATE)::text AS active_today,
      (SELECT COUNT(DISTINCT user_id) FROM daily_active_users
        WHERE day >= CURRENT_DATE - 6)::text AS active_week,
      (SELECT COUNT(*) FROM matches WHERE status = 'finished')::text AS matches_total,
      (SELECT COUNT(*) FROM matches
        WHERE status = 'finished' AND finished_at >= CURRENT_DATE)::text AS matches_today,
      (SELECT COALESCE(SUM(bet_amount * 2), 0) FROM matches
        WHERE status = 'finished' AND finished_at >= CURRENT_DATE)::text AS wagered_today,
      (SELECT COALESCE(SUM(coins_balance), 0) FROM users)::text AS coins_in_play,
      (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE amount > 0)::text AS issued,
      (SELECT COUNT(*) FROM matches WHERE status = 'active')::text AS matches_live,
      (SELECT COUNT(*) FROM matches WHERE status = 'searching' AND player2_id IS NULL)::text AS searching
  `)

  return {
    players: Number(row?.players ?? 0),
    playersToday: Number(row?.players_today ?? 0),
    activeToday: Number(row?.active_today ?? 0),
    activeWeek: Number(row?.active_week ?? 0),
    matchesTotal: Number(row?.matches_total ?? 0),
    matchesToday: Number(row?.matches_today ?? 0),
    wageredToday: Number(row?.wagered_today ?? 0),
    coinsInPlay: Number(row?.coins_in_play ?? 0),
    issued: Number(row?.issued ?? 0),
    matchesLive: Number(row?.matches_live ?? 0),
    searching: Number(row?.searching ?? 0),
  }
}

/** Последние дни: сколько заходов, матчей и медяков в игре. */
export async function lastDays(days = 14): Promise<
  { day: string; active: number; matches: number; wagered: number }[]
> {
  return query<{ day: string; active: number; matches: number; wagered: number }>(
    /*
     * generate_series по датам возвращает метки времени, а не даты. Без
     * приведения к date в таблицу попадало «26 00:00:00+00» вместо «26.08».
     */
    `SELECT d.day::text AS day,
            (SELECT COUNT(*) FROM daily_active_users a WHERE a.day = d.day)::int AS active,
            (SELECT COUNT(*) FROM matches m
              WHERE m.status = 'finished' AND m.finished_at::date = d.day)::int AS matches,
            (SELECT COALESCE(SUM(m.bet_amount * 2), 0) FROM matches m
              WHERE m.status = 'finished' AND m.finished_at::date = d.day)::int AS wagered
       FROM (
         SELECT generate_series(CURRENT_DATE - $1::int + 1, CURRENT_DATE, '1 day')::date AS day
       ) AS d
      ORDER BY d.day DESC`,
    [days],
  )
}

export interface PlayerRow {
  id: number
  nickname: string
  telegram_id: number
  telegram_username: string | null
  rating: number
  coins_balance: number
  games_played: number
  wins: number
  losses: number
  banned_at: string | null
  created_at: string
  last_seen_at: string
}

export async function players(
  search: string,
  page: number,
  perPage = 30,
): Promise<{ rows: PlayerRow[]; hasMore: boolean }> {
  const params: unknown[] = []
  const conditions: string[] = []
  const term = search.trim()

  if (term) {
    params.push(`%${term.toLowerCase()}%`)
    const like = `$${params.length}`

    // Поиск по номеру работает только если это действительно число:
    // сравнивать текст с BIGINT база не станет.
    const asNumber = Number(term)
    params.push(Number.isSafeInteger(asNumber) ? asNumber : 0)
    const exact = `$${params.length}`

    conditions.push(
      `(lower(nickname) LIKE ${like}
         OR lower(COALESCE(telegram_username, '')) LIKE ${like}
         OR telegram_id = ${exact}
         OR id = ${exact})`,
    )
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(perPage + 1, page * perPage)

  const rows = await query<PlayerRow>(
    `SELECT id, nickname, telegram_id, telegram_username, rating, coins_balance,
            games_played, wins, losses, banned_at, created_at, last_seen_at
       FROM users
       ${where}
      ORDER BY last_seen_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  return { rows: rows.slice(0, perPage), hasMore: rows.length > perPage }
}

export async function player(id: number): Promise<PlayerRow | null> {
  return queryOne<PlayerRow>(
    `SELECT id, nickname, telegram_id, telegram_username, rating, coins_balance,
            games_played, wins, losses, banned_at, created_at, last_seen_at
       FROM users WHERE id = $1`,
    [id],
  )
}

/** Сходится ли баланс игрока с суммой его операций. */
export async function playerLedger(id: number): Promise<{ balance: number; sum: number }> {
  const row = await queryOne<{ balance: string; sum: string }>(
    `SELECT u.coins_balance::text AS balance,
            (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE user_id = u.id)::text AS sum
       FROM users u WHERE u.id = $1`,
    [id],
  )
  return { balance: Number(row?.balance ?? 0), sum: Number(row?.sum ?? 0) }
}

export interface TransactionRow {
  id: number
  user_id: number
  nickname: string
  type: string
  amount: number
  balance_after: number
  match_id: number | null
  comment: string | null
  created_at: string
}

export async function transactions(
  filter: { userId?: number; type?: string },
  page: number,
  perPage = 50,
): Promise<{ rows: TransactionRow[]; hasMore: boolean }> {
  const params: unknown[] = []
  const conditions: string[] = []

  if (filter.userId) {
    params.push(filter.userId)
    conditions.push(`t.user_id = $${params.length}`)
  }
  if (filter.type) {
    params.push(filter.type)
    conditions.push(`t.type = $${params.length}`)
  }

  params.push(perPage + 1, page * perPage)

  const rows = await query<TransactionRow>(
    `SELECT t.id, t.user_id, u.nickname, t.type, t.amount::int AS amount,
            t.balance_after::int AS balance_after, t.match_id, t.comment, t.created_at
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  return { rows: rows.slice(0, perPage), hasMore: rows.length > perPage }
}

export interface MatchRowAdmin {
  id: number
  mode: string
  status: string
  bet_amount: number
  rounds_total: number
  score1: number
  score2: number
  winner_id: number | null
  finish_reason: string | null
  created_at: string
  finished_at: string | null
  player1: string
  player2: string | null
  player1_id: number
  player2_id: number | null
}

export async function matches(
  filter: { userId?: number; status?: string },
  page: number,
  perPage = 30,
): Promise<{ rows: MatchRowAdmin[]; hasMore: boolean }> {
  const params: unknown[] = []
  const conditions: string[] = []

  if (filter.userId) {
    params.push(filter.userId)
    conditions.push(`(m.player1_id = $${params.length} OR m.player2_id = $${params.length})`)
  }
  if (filter.status) {
    params.push(filter.status)
    conditions.push(`m.status = $${params.length}`)
  }

  params.push(perPage + 1, page * perPage)

  const rows = await query<MatchRowAdmin>(
    `SELECT m.id, m.mode::text AS mode, m.status::text AS status, m.bet_amount, m.rounds_total,
            m.score1, m.score2, m.winner_id, m.finish_reason, m.created_at, m.finished_at,
            m.player1_id, m.player2_id,
            p1.nickname AS player1, p2.nickname AS player2
       FROM matches m
       JOIN users p1 ON p1.id = m.player1_id
       LEFT JOIN users p2 ON p2.id = m.player2_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY m.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  return { rows: rows.slice(0, perPage), hasMore: rows.length > perPage }
}

export async function matchById(id: number): Promise<MatchRowAdmin | null> {
  const rows = await query<MatchRowAdmin>(
    `SELECT m.id, m.mode::text AS mode, m.status::text AS status, m.bet_amount, m.rounds_total,
            m.score1, m.score2, m.winner_id, m.finish_reason, m.created_at, m.finished_at,
            m.player1_id, m.player2_id,
            p1.nickname AS player1, p2.nickname AS player2
       FROM matches m
       JOIN users p1 ON p1.id = m.player1_id
       LEFT JOIN users p2 ON p2.id = m.player2_id
      WHERE m.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export interface RoundRowAdmin {
  round_number: number
  player1_choice: string | null
  player2_choice: string | null
  result: string | null
  player1_timed_out: boolean
  player2_timed_out: boolean
  abandoned: boolean
  started_at: string
  player1_move_at: string | null
  player2_move_at: string | null
}

export async function matchRounds(matchId: number): Promise<RoundRowAdmin[]> {
  return query<RoundRowAdmin>(
    `SELECT round_number, player1_choice::text, player2_choice::text, result::text,
            player1_timed_out, player2_timed_out, abandoned,
            started_at, player1_move_at, player2_move_at
       FROM rounds WHERE match_id = $1 ORDER BY round_number`,
    [matchId],
  )
}

/**
 * Воронка: сколько игроков дошло до каждого шага.
 *
 * Считается по людям, а не по событиям: один и тот же игрок, открывший
 * приложение десять раз, — это один человек, а не десять.
 */
export async function funnel(days: number): Promise<{ step: string; label: string; players: number }[]> {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - $1::int)::text AS registered,
       (SELECT COUNT(*) FROM users
         WHERE created_at >= CURRENT_DATE - $1::int
           AND consent_accepted_at IS NOT NULL)::text AS consented,
       (SELECT COUNT(DISTINCT player1_id) FROM matches
         WHERE created_at >= CURRENT_DATE - $1::int)::text AS created_match,
       (SELECT COUNT(DISTINCT u.id) FROM users u
         WHERE u.created_at >= CURRENT_DATE - $1::int
           AND EXISTS (SELECT 1 FROM matches m
                        WHERE m.status = 'finished'
                          AND (m.player1_id = u.id OR m.player2_id = u.id)))::text AS played,
       (SELECT COUNT(DISTINCT u.id) FROM users u
         WHERE u.created_at >= CURRENT_DATE - $1::int
           AND u.games_played >= 2)::text AS played_twice`,
    [days],
  )

  return [
    { step: 'registered', label: 'Зашли в игру', players: Number(row?.registered ?? 0) },
    { step: 'consented', label: 'Приняли условия', players: Number(row?.consented ?? 0) },
    { step: 'created_match', label: 'Начали искать бой', players: Number(row?.created_match ?? 0) },
    { step: 'played', label: 'Доиграли матч', players: Number(row?.played ?? 0) },
    { step: 'played_twice', label: 'Сыграли ещё раз', players: Number(row?.played_twice ?? 0) },
  ]
}

/** Что вообще происходит в приложении — сырые события по частоте. */
export async function topEvents(days: number): Promise<{ name: string; count: number; players: number }[]> {
  return query<{ name: string; count: number; players: number }>(
    `SELECT name, COUNT(*)::int AS count, COUNT(DISTINCT user_id)::int AS players
       FROM events
      WHERE created_at >= CURRENT_DATE - $1::int
      GROUP BY name
      ORDER BY count DESC
      LIMIT 30`,
    [days],
  )
}

export async function appConfig(): Promise<
  { key: string; value: string; description: string | null; updated_at: string }[]
> {
  return query(
    `SELECT key, value::text AS value, description, updated_at
       FROM app_config ORDER BY key`,
  )
}

export async function auditLog(page: number, perPage = 50): Promise<{
  rows: {
    id: number
    action: string
    target_type: string | null
    target_id: number | null
    before: unknown
    after: unknown
    comment: string | null
    created_at: string
    admin: string
  }[]
  hasMore: boolean
}> {
  const rows = await query<{
    id: number
    action: string
    target_type: string | null
    target_id: number | null
    before: unknown
    after: unknown
    comment: string | null
    created_at: string
    admin: string
  }>(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.before, a.after, a.comment,
            a.created_at, ad.display_name AS admin
       FROM admin_audit a
       JOIN admins ad ON ad.id = a.admin_id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2`,
    [perPage + 1, page * perPage],
  )
  return { rows: rows.slice(0, perPage), hasMore: rows.length > perPage }
}
