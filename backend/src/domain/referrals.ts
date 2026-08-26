import type { PoolClient } from 'pg'
import { query } from '../db/client.js'
import { getEconomyConfig } from './appConfig.js'
import { postEntry, DuplicateOperation } from './ledger.js'

/**
 * Реферальная программа (ЧАСТЬ 3, п.6).
 *
 * Приглашённый получает свои медяки сразу при регистрации, а пригласивший —
 * только после того, как приглашённый сыграл первый платный матч. Иначе
 * программу накручивают пустыми регистрациями: завёл десять аккаунтов,
 * получил десять бонусов, ни одной игры.
 */

/**
 * Платит бонус пригласившему, если этот игрок только что сыграл свой первый
 * платный матч. Вызывается из завершения матча, внутри его транзакции.
 *
 * Повторную выплату исключают сразу две вещи: флаг bonus_paid и уникальный
 * external_id операции. Даже если завершение матча каким-то образом
 * повторится, вторых денег не будет.
 */
export async function payReferralBonusIfDue(
  client: PoolClient,
  referredId: number,
): Promise<{ paid: boolean; referrerId?: number; amount?: number }> {
  const { rows } = await client.query<{ id: number; referrer_id: number }>(
    `SELECT id, referrer_id
       FROM referrals
      WHERE referred_id = $1 AND bonus_paid = FALSE
      FOR UPDATE`,
    [referredId],
  )
  const referral = rows[0]
  if (!referral) return { paid: false }

  /*
   * Считаем только платные матчи: бесплатные игры с другом не должны
   * открывать выплату, иначе достаточно одной договорной игры на ноль.
   */
  const { rows: counted } = await client.query<{ played: number }>(
    `SELECT COUNT(*)::int AS played
       FROM matches
      WHERE status = 'finished'
        AND bet_amount > 0
        AND (player1_id = $1 OR player2_id = $1)`,
    [referredId],
  )
  if ((counted[0]?.played ?? 0) < 1) return { paid: false }

  const { rows: lastMatch } = await client.query<{ id: number }>(
    `SELECT id
       FROM matches
      WHERE status = 'finished'
        AND bet_amount > 0
        AND (player1_id = $1 OR player2_id = $1)
      ORDER BY finished_at DESC
      LIMIT 1`,
    [referredId],
  )

  const economy = await getEconomyConfig()

  try {
    await postEntry(client, {
      userId: referral.referrer_id,
      type: 'referral_bonus',
      amount: economy.referralInviterBonus,
      externalId: `referral_bonus:${referral.id}`,
      comment: 'Бонус за приглашённого игрока',
      meta: { referredId },
    })
  } catch (error) {
    if (error instanceof DuplicateOperation) {
      await client.query(
        `UPDATE referrals SET bonus_paid = TRUE, bonus_paid_at = now() WHERE id = $1`,
        [referral.id],
      )
      return { paid: false }
    }
    throw error
  }

  await client.query(
    `UPDATE referrals
        SET bonus_paid = TRUE, bonus_paid_at = now(), qualifying_match_id = $2
      WHERE id = $1`,
    [referral.id, lastMatch[0]?.id ?? null],
  )

  return { paid: true, referrerId: referral.referrer_id, amount: economy.referralInviterBonus }
}

export interface ReferralSummary {
  invited: number
  paid: number
  pending: number
  earned: number
  friends: { id: number; nickname: string; avatarId: string; bonusPaid: boolean; joinedAt: string }[]
}

/** Сводка для листа рефералов в приложении. */
export async function getReferralSummary(userId: number): Promise<ReferralSummary> {
  const rows = await query<{
    referred_id: number
    nickname: string
    avatar_id: string
    bonus_paid: boolean
    created_at: string
  }>(
    `SELECT r.referred_id, u.nickname, u.avatar_id, r.bonus_paid, r.created_at
       FROM referrals r
       JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = $1
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [userId],
  )

  const earnedRows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM transactions
      WHERE user_id = $1 AND type = 'referral_bonus'`,
    [userId],
  )

  const paid = rows.filter((r) => r.bonus_paid).length

  return {
    invited: rows.length,
    paid,
    pending: rows.length - paid,
    earned: Number(earnedRows[0]?.total ?? 0),
    friends: rows.map((r) => ({
      id: r.referred_id,
      nickname: r.nickname,
      avatarId: r.avatar_id,
      bonusPaid: r.bonus_paid,
      joinedAt: r.created_at,
    })),
  }
}
