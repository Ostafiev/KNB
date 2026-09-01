import { query, queryOne } from '../db/client.js'
import { isOnline } from './presence.js'
import { startMatch, MatchError, type MatchRow, type StartedMatch } from './match.js'

/**
 * Приглашение другу — встреча, а не очередь.
 *
 * Человек отправляет вызов и идёт по своим делам. Друг открывает ссылку когда
 * освободится и отмечает, что готов. Бой начинается в тот момент, когда оба
 * отметились и оба у экрана; до этого ставка не списана и терять нечего.
 *
 * Ждать на экране не нужно никому: если второго нет, первому просто скажут
 * об этом, а когда второй появится — придёт окно «играем?».
 */

/** Сколько живёт приглашение по ссылке. Сутки — чтобы успел и тот, кто занят. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

/** На сколько замолкает окно «друг принял», если сейчас неудобно. */
export const SNOOZE_MS = 60 * 60 * 1000

export interface InviteView {
  matchId: number
  bet: number
  rounds: number
  condition: string | null
  /**
   * Кому именно адресован вызов.
   *
   * Ссылка-приглашение открыта для любого, кто её получил (invitedId = null),
   * а личный вызов из списка друзей — только для одного человека. Разница
   * должна быть видна всем, кто пускает игрока в матч.
   */
  invitedId: number | null
  host: { id: number; nickname: string; avatarId: string; rating: number }
  guest: { id: number; nickname: string; avatarId: string; rating: number } | null
  hostReady: boolean
  guestReady: boolean
  expiresAt: number | null
}

interface Row {
  id: number
  bet_amount: number
  rounds_total: number
  condition: string | null
  invited_id: number | null
  expires_at: string | null
  host_ready_at: string | null
  guest_ready_at: string | null
  host_id: number
  host_nickname: string
  host_avatar: string
  host_rating: number
  guest_id: number | null
  guest_nickname: string | null
  guest_avatar: string | null
  guest_rating: number | null
}

const SELECT_INVITE = `
  SELECT m.id, m.bet_amount, m.rounds_total, m.condition, m.invited_id, m.expires_at,
         m.host_ready_at, m.guest_ready_at,
         h.id AS host_id, h.nickname AS host_nickname, h.avatar_id AS host_avatar,
         h.rating AS host_rating,
         g.id AS guest_id, g.nickname AS guest_nickname, g.avatar_id AS guest_avatar,
         g.rating AS guest_rating
    FROM matches m
    JOIN users h ON h.id = m.player1_id
    LEFT JOIN users g ON g.id = m.player2_id
   WHERE m.status = 'pending' AND m.mode = 'friend'`

function toView(row: Row): InviteView {
  return {
    matchId: row.id,
    bet: Number(row.bet_amount),
    rounds: row.rounds_total,
    condition: row.condition,
    invitedId: row.invited_id,
    host: {
      id: row.host_id,
      nickname: row.host_nickname,
      avatarId: row.host_avatar,
      rating: row.host_rating,
    },
    guest:
      row.guest_id !== null
        ? {
            id: row.guest_id,
            nickname: row.guest_nickname!,
            avatarId: row.guest_avatar!,
            rating: row.guest_rating!,
          }
        : null,
    hostReady: row.host_ready_at !== null,
    guestReady: row.guest_ready_at !== null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
  }
}

export async function getInvite(matchId: number): Promise<InviteView | null> {
  const row = await queryOne<Row>(`${SELECT_INVITE} AND m.id = $1`, [matchId])
  return row ? toView(row) : null
}

// ─── Готовность ──────────────────────────────────────────────────────────────

/**
 * Отмечает, что игрок у экрана и готов играть.
 *
 * Возвращает приглашение и признак того, что теперь готовы оба, — тогда
 * вызывающий слой начинает бой.
 */
export async function markReady(
  matchId: number,
  userId: number,
): Promise<{ invite: InviteView; bothReady: boolean } | null> {
  const match = await queryOne<MatchRow>('SELECT * FROM matches WHERE id = $1', [matchId])
  if (!match || match.status !== 'pending') return null

  const column =
    match.player1_id === userId
      ? 'host_ready_at'
      : match.player2_id === userId
        ? 'guest_ready_at'
        : null
  if (!column) return null

  await query(
    `UPDATE matches
        SET ${column} = now(),
            snoozed_until = CASE WHEN $2 = 'host_ready_at' THEN NULL ELSE snoozed_until END
      WHERE id = $1`,
    [matchId, column],
  )

  const invite = await getInvite(matchId)
  if (!invite) return null
  return { invite, bothReady: invite.hostReady && invite.guestReady && invite.guest !== null }
}

/** «Сейчас неудобно»: окно перестаёт всплывать на час, приглашение остаётся. */
export async function snooze(matchId: number, userId: number): Promise<InviteView | null> {
  const match = await queryOne<MatchRow>('SELECT * FROM matches WHERE id = $1', [matchId])
  if (!match || match.status !== 'pending' || match.player1_id !== userId) return null

  await query(
    `UPDATE matches
        SET host_ready_at = NULL,
            snoozed_until = now() + ($2::int * INTERVAL '1 millisecond')
      WHERE id = $1`,
    [matchId, SNOOZE_MS],
  )
  return getInvite(matchId)
}

/** Игрок ушёл с экрана ожидания. Приглашение живёт, но караулить его не нужно. */
export async function clearReady(matchId: number, userId: number): Promise<void> {
  await query(
    `UPDATE matches
        SET host_ready_at  = CASE WHEN player1_id = $2 THEN NULL ELSE host_ready_at END,
            guest_ready_at = CASE WHEN player2_id = $2 THEN NULL ELSE guest_ready_at END
      WHERE id = $1 AND status = 'pending'`,
    [matchId, userId],
  )
}

/** Все приглашения игрока, где он отметился ожидающим. */
export async function releaseAll(userId: number): Promise<void> {
  await query(
    `UPDATE matches
        SET host_ready_at  = CASE WHEN player1_id = $1 THEN NULL ELSE host_ready_at END,
            guest_ready_at = CASE WHEN player2_id = $1 THEN NULL ELSE guest_ready_at END
      WHERE status = 'pending'
        AND (player1_id = $1 OR player2_id = $1)`,
    [userId],
  )
}

// ─── Что показать игроку ─────────────────────────────────────────────────────

/**
 * Приглашения, которые ждут именно этого человека.
 *
 * Хозяину — те, где друг уже принял вызов и ждёт (и «позже» ещё не нажимали).
 * Гостю — те, где хозяин вернулся и готов играть.
 */
export async function invitesNeedingAttention(userId: number): Promise<InviteView[]> {
  const rows = await query<Row>(
    `${SELECT_INVITE}
       AND (m.expires_at IS NULL OR m.expires_at > now())
       AND (
         (m.player1_id = $1 AND m.guest_ready_at IS NOT NULL
            AND (m.snoozed_until IS NULL OR m.snoozed_until < now()))
         OR
         (m.player2_id = $1 AND m.host_ready_at IS NOT NULL)
       )
     ORDER BY m.created_at`,
    [userId],
  )
  return rows.map(toView)
}

/**
 * Оба отметились и оба на связи — можно начинать.
 *
 * Проверка живёт здесь, а не в местах вызова: начать бой можно из трёх
 * разных мест, и правило должно быть одно.
 */
export async function startIfBothReady(matchId: number): Promise<StartedMatch | null> {
  const invite = await getInvite(matchId)
  if (!invite || !invite.guest) return null
  if (!invite.hostReady || !invite.guestReady) return null
  if (!isOnline(invite.host.id) || !isOnline(invite.guest.id)) return null

  try {
    return await startMatch(matchId, invite.guest.id)
  } catch (error) {
    // Ставки могло не хватить или кто-то успел войти в другой бой —
    // приглашение остаётся, игроки увидят причину.
    if (error instanceof MatchError) return null
    throw error
  }
}

/** Просроченные приглашения закрываем: ставка не списана, терять нечего. */
export async function expireStaleInvites(): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE matches
        SET status = 'expired', finished_at = now()
      WHERE status = 'pending'
        AND mode = 'friend'
        AND expires_at IS NOT NULL
        AND expires_at <= now()
      RETURNING id`,
  )
  return rows.length
}
