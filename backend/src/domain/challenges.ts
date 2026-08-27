import { query, queryOne } from '../db/client.js'
import { areConnected } from './friends.js'
import { isOnline } from './presence.js'
import {
  createMatch,
  startMatch,
  MatchError,
  type MatchRow,
  type StartedMatch,
} from './match.js'

/**
 * Вызов на бой.
 *
 * Раньше позвать друга можно было только ссылкой: отправил в переписку, он
 * открыл, вошёл. Работает, но медленно и не годится, когда друг уже сидит
 * в приложении рядом.
 *
 * Вызов — это матч с mode='friend' в состоянии «ещё не начался», у которого
 * записано, кого зовут и до какого момента ждут ответа. Ставка при вызове не
 * списывается: медяки уходят только когда оба игрока вошли в бой. Значит
 * отклонённый или просроченный вызов не стоит никому ничего.
 */

/** Сколько вызов ждёт ответа. Минута — столько человек готов смотреть на окно. */
export const CHALLENGE_TTL_MS = 60_000

/** Сколько вызовов подряд можно разослать. Защита от навязчивости. */
const MAX_PER_MINUTE = 5

export interface ChallengeView {
  matchId: number
  from: { id: number; nickname: string; avatarId: string; rating: number }
  to: { id: number; nickname: string; avatarId: string; rating: number }
  bet: number
  rounds: number
  condition: string | null
  expiresAt: number
}

interface PairRow {
  id: number
  bet_amount: number
  rounds_total: number
  condition: string | null
  expires_at: string
  from_id: number
  from_nickname: string
  from_avatar: string
  from_rating: number
  to_id: number
  to_nickname: string
  to_avatar: string
  to_rating: number
}

const SELECT_CHALLENGE = `
  SELECT m.id, m.bet_amount, m.rounds_total, m.condition, m.expires_at,
         f.id AS from_id, f.nickname AS from_nickname, f.avatar_id AS from_avatar,
         f.rating AS from_rating,
         t.id AS to_id, t.nickname AS to_nickname, t.avatar_id AS to_avatar,
         t.rating AS to_rating
    FROM matches m
    JOIN users f ON f.id = m.player1_id
    JOIN users t ON t.id = m.invited_id
   WHERE m.status = 'pending'
     AND m.invited_id IS NOT NULL
     AND m.expires_at > now()`

function toView(row: PairRow): ChallengeView {
  return {
    matchId: row.id,
    from: {
      id: row.from_id,
      nickname: row.from_nickname,
      avatarId: row.from_avatar,
      rating: row.from_rating,
    },
    to: {
      id: row.to_id,
      nickname: row.to_nickname,
      avatarId: row.to_avatar,
      rating: row.to_rating,
    },
    bet: Number(row.bet_amount),
    rounds: row.rounds_total,
    condition: row.condition,
    expiresAt: new Date(row.expires_at).getTime(),
  }
}

async function viewOf(matchId: number): Promise<ChallengeView | null> {
  const row = await queryOne<PairRow>(`${SELECT_CHALLENGE} AND m.id = $1`, [matchId])
  return row ? toView(row) : null
}

// ─── Отправка ────────────────────────────────────────────────────────────────

export interface SendChallengeInput {
  fromId: number
  toId: number
  bet: number
  rounds: number
  condition?: string | null
}

/**
 * Позвать друга на бой прямо сейчас.
 *
 * Звать можно только того, с кем уже есть связь: приглашение или сыгранный
 * матч. Иначе вызов стал бы способом доставать незнакомых людей по номеру.
 */
export async function sendChallenge(input: SendChallengeInput): Promise<ChallengeView> {
  if (input.fromId === input.toId) {
    throw new MatchError('same_player', 'нельзя позвать самого себя')
  }

  const target = await queryOne<{ id: number; banned_at: string | null; is_bot: boolean }>(
    'SELECT id, banned_at, is_bot FROM users WHERE id = $1',
    [input.toId],
  )
  if (!target) throw new MatchError('user_not_found', 'игрок не найден')
  if (target.banned_at) throw new MatchError('banned', 'этот игрок заблокирован')
  if (target.is_bot) throw new MatchError('bot_not_invitable', 'этого соперника нельзя позвать')

  if (!(await areConnected(input.fromId, input.toId))) {
    throw new MatchError('not_connected', 'позвать можно только того, с кем уже играли')
  }

  const recent = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM matches
      WHERE player1_id = $1
        AND invited_id IS NOT NULL
        AND created_at > now() - INTERVAL '1 minute'`,
    [input.fromId],
  )
  if (Number(recent?.count ?? 0) >= MAX_PER_MINUTE) {
    throw new MatchError('too_many_challenges', 'слишком много вызовов подряд, подожди минуту')
  }

  if (await isBusy(input.fromId)) {
    throw new MatchError('already_in_match', 'ты уже в бою')
  }
  if (await isBusy(input.toId)) {
    throw new MatchError('opponent_busy', 'этот игрок сейчас в бою')
  }

  // Один вызов за раз: старые снимаем, иначе у друга накопится очередь окон.
  await cancelOutgoing(input.fromId)

  const match = await createMatch({
    mode: 'friend',
    player1Id: input.fromId,
    bet: input.bet,
    rounds: input.rounds,
    condition: input.condition ?? null,
    invitedId: input.toId,
    expiresInMs: CHALLENGE_TTL_MS,
  })

  const view = await viewOf(match.id)
  if (!view) throw new MatchError('challenge_failed', 'не удалось создать вызов')
  return view
}

/** Уже играет или ждёт соперника в подборе. */
async function isBusy(userId: number): Promise<boolean> {
  const row = await queryOne<{ busy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM matches
        WHERE status = 'active' AND (player1_id = $1 OR player2_id = $1)
     ) AS busy`,
    [userId],
  )
  return row?.busy === true
}

// ─── Ответ ───────────────────────────────────────────────────────────────────

/**
 * Принять вызов. Здесь же списываются обе ставки — startMatch делает это
 * одной транзакцией, поэтому «принял, а медяков не хватило» не оставит
 * позвавшего без денег.
 */
export async function acceptChallenge(matchId: number, userId: number): Promise<StartedMatch> {
  const match = await queryOne<MatchRow>('SELECT * FROM matches WHERE id = $1', [matchId])
  if (!match) throw new MatchError('match_not_found', 'вызов не найден')
  if (match.invited_id !== userId) throw new MatchError('not_invited', 'этот вызов не тебе')

  return startMatch(matchId, userId)
}

/** Отказаться. Матч закрывается, никто ничего не теряет. */
export async function declineChallenge(
  matchId: number,
  userId: number,
): Promise<ChallengeView | null> {
  const view = await viewOf(matchId)
  if (!view || view.to.id !== userId) return null

  await query(
    `UPDATE matches SET status = 'cancelled', finished_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [matchId],
  )
  return view
}

/** Отозвать свой вызов. */
export async function cancelChallenge(
  matchId: number,
  userId: number,
): Promise<ChallengeView | null> {
  const view = await viewOf(matchId)
  if (!view || view.from.id !== userId) return null

  await query(
    `UPDATE matches SET status = 'cancelled', finished_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [matchId],
  )
  return view
}

async function cancelOutgoing(userId: number): Promise<void> {
  await query(
    `UPDATE matches SET status = 'cancelled', finished_at = now()
      WHERE player1_id = $1 AND invited_id IS NOT NULL AND status = 'pending'`,
    [userId],
  )
}

/**
 * Игрок закрыл приложение. Его вызовы больше не имеют смысла: принявшему
 * пришлось бы играть с тем, кого нет. Возвращаем, кого надо предупредить.
 *
 * Входящие вызовы при этом не трогаем — человек мог просто перезагрузить
 * страницу, и через минуту они погаснут сами.
 */
export async function dropOutgoingOf(userId: number): Promise<{ matchId: number; to: number }[]> {
  const rows = await query<{ id: number; invited_id: number }>(
    `UPDATE matches SET status = 'cancelled', finished_at = now()
      WHERE player1_id = $1 AND invited_id IS NOT NULL AND status = 'pending'
      RETURNING id, invited_id`,
    [userId],
  )
  return rows.map((row) => ({ matchId: row.id, to: row.invited_id }))
}

// ─── Чтение ──────────────────────────────────────────────────────────────────

/** Вызовы, ждущие ответа. Нужны после переподключения: окно должно вернуться. */
export async function listChallenges(
  userId: number,
): Promise<{ incoming: ChallengeView[]; outgoing: ChallengeView[] }> {
  const rows = await query<PairRow>(
    `${SELECT_CHALLENGE} AND (m.player1_id = $1 OR m.invited_id = $1) ORDER BY m.created_at`,
    [userId],
  )
  const all = rows.map(toView)
  return {
    incoming: all.filter((c) => c.to.id === userId),
    outgoing: all.filter((c) => c.from.id === userId),
  }
}

/**
 * Гасит вызовы, на которые не ответили. Возвращает погашенные, чтобы обе
 * стороны узнали об этом, а не смотрели на застывшее окно.
 */
export async function expireStale(): Promise<{ matchId: number; from: number; to: number }[]> {
  const rows = await query<{ id: number; player1_id: number; invited_id: number }>(
    `UPDATE matches
        SET status = 'expired', finished_at = now()
      WHERE status = 'pending'
        AND invited_id IS NOT NULL
        AND expires_at IS NOT NULL
        AND expires_at <= now()
      RETURNING id, player1_id, invited_id`,
  )
  return rows.map((row) => ({ matchId: row.id, from: row.player1_id, to: row.invited_id }))
}

/**
 * Вызов другу, которого нет на связи, бессмыслен: окно ему показать некому,
 * а через минуту вызов погаснет. В таком случае зовём ссылкой.
 */
export function canChallengeNow(userId: number): boolean {
  return isOnline(userId)
}
