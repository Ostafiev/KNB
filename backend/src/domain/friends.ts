import { query, queryOne } from '../db/client.js'
import { isOnline } from './presence.js'

/**
 * Друзья.
 *
 * Telegram не отдаёт список контактов — ни одному боту и ни одному Mini App.
 * Это закрыто намеренно, и обойти это нечем. Значит список друзей приходится
 * собирать из того, что мы про людей знаем честно:
 *
 *   1. кто пришёл по твоей ссылке-приглашению;
 *   2. кто пригласил тебя;
 *   3. с кем ты действительно играл.
 *
 * Третий источник — самый ценный. Человек, с которым сыграно пять боёв, ближе
 * к слову «друг», чем случайный контакт из записной книжки. Боты в список не
 * попадают: дружить с программой не с чем.
 *
 * Каждая строка помнит, откуда взялась, и приложение это показывает. Список
 * без объяснения, откуда в нём люди, выглядит как утечка чужих данных.
 */

export type FriendSource = 'invited' | 'inviter' | 'played'

export interface Friend {
  id: number
  nickname: string
  avatarId: string
  rating: number
  online: boolean
  source: FriendSource
  /** Сколько платных матчей сыграно друг с другом. */
  games: number
  wins: number
  losses: number
  lastPlayedAt: string | null
  /** Приглашённый уже сыграл первый матч — бонус начислен. */
  bonusPaid: boolean
}

interface Row {
  id: number
  nickname: string
  avatar_id: string
  rating: number
  source: FriendSource
  games: number
  wins: number
  losses: number
  last_played_at: string | null
  bonus_paid: boolean
}

/**
 * Все, кого игрок может позвать на бой.
 *
 * Один и тот же человек может быть и приглашённым, и соперником по матчам.
 * Дубли схлопываем, оставляя более близкий источник: приглашение важнее
 * случайной встречи в подборе.
 */
export async function listFriends(userId: number, limit = 100): Promise<Friend[]> {
  const rows = await query<Row>(
    `WITH linked AS (
       -- Пришли по моей ссылке
       SELECT r.referred_id AS other_id, 'invited'::text AS source, r.bonus_paid, 1 AS priority
         FROM referrals r
        WHERE r.referrer_id = $1
       UNION ALL
       -- Пригласил меня
       SELECT r.referrer_id, 'inviter'::text, r.bonus_paid, 2
         FROM referrals r
        WHERE r.referred_id = $1
       UNION ALL
       -- Играли вместе
       SELECT CASE WHEN m.player1_id = $1 THEN m.player2_id ELSE m.player1_id END,
              'played'::text, FALSE, 3
         FROM matches m
        WHERE m.status = 'finished'
          AND (m.player1_id = $1 OR m.player2_id = $1)
          AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
     ),
     -- Один человек — одна строка: оставляем самый близкий источник.
     best AS (
       SELECT DISTINCT ON (other_id) other_id, source, bonus_paid
         FROM linked
        WHERE other_id IS NOT NULL AND other_id <> $1
        ORDER BY other_id, priority
     ),
     -- Личный счёт встреч. Бесплатные матчи тоже считаем: они сыграны.
     head_to_head AS (
       SELECT CASE WHEN m.player1_id = $1 THEN m.player2_id ELSE m.player1_id END AS other_id,
              COUNT(*)::int AS games,
              SUM(CASE WHEN m.winner_id = $1 THEN 1 ELSE 0 END)::int AS wins,
              SUM(CASE WHEN m.winner_id IS NOT NULL AND m.winner_id <> $1 THEN 1 ELSE 0 END)::int
                AS losses,
              MAX(m.finished_at)::text AS last_played_at
         FROM matches m
        WHERE m.status = 'finished'
          AND (m.player1_id = $1 OR m.player2_id = $1)
        GROUP BY 1
     )
     SELECT u.id, u.nickname, u.avatar_id, u.rating,
            b.source, b.bonus_paid,
            COALESCE(h.games, 0) AS games,
            COALESCE(h.wins, 0) AS wins,
            COALESCE(h.losses, 0) AS losses,
            h.last_played_at
       FROM best b
       JOIN users u ON u.id = b.other_id
       LEFT JOIN head_to_head h ON h.other_id = b.other_id
      WHERE NOT u.is_bot
        AND u.banned_at IS NULL
      ORDER BY h.last_played_at DESC NULLS LAST, u.id
      LIMIT $2`,
    [userId, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    avatarId: row.avatar_id,
    rating: row.rating,
    online: isOnline(row.id),
    source: row.source,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    lastPlayedAt: row.last_played_at,
    bonusPaid: row.bonus_paid,
  }))
}

/**
 * Можно ли позвать этого человека на бой.
 *
 * Звать кого угодно по номеру нельзя: иначе приглашения превратятся
 * в способ доставать незнакомых людей. Позвать можно того, с кем уже есть
 * связь — приглашение или сыгранный матч.
 */
export async function areConnected(userId: number, otherId: number): Promise<boolean> {
  if (userId === otherId) return false

  const row = await queryOne<{ connected: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM referrals
        WHERE (referrer_id = $1 AND referred_id = $2)
           OR (referrer_id = $2 AND referred_id = $1)
       UNION ALL
       SELECT 1 FROM matches
        WHERE status = 'finished'
          AND ((player1_id = $1 AND player2_id = $2) OR (player1_id = $2 AND player2_id = $1))
     ) AS connected`,
    [userId, otherId],
  )
  return row?.connected === true
}
