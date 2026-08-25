import type { PoolClient } from 'pg'
import { withTransaction } from '../db/client.js'

/**
 * Единственная точка изменения баланса медяков.
 *
 * Каждое движение пишет строку в transactions и обновляет users.coins_balance
 * в одной транзакции БД. Ни один другой модуль не имеет права трогать баланс
 * напрямую — иначе журнал перестанет сходиться с балансом, и разбирать споры
 * будет нечем.
 */

export type LedgerType =
  | 'signup_bonus'
  | 'daily_bonus'
  | 'referral_bonus'
  | 'referral_signup'
  | 'ad_reward'
  | 'bet_hold'
  | 'bet_refund'
  | 'match_win'
  | 'topup_stars'
  | 'topup_ton'
  | 'withdrawal'
  | 'withdrawal_fee'
  | 'admin_adjustment'

export interface LedgerEntry {
  userId: number
  type: LedgerType
  /** Знаковая величина: положительная — начисление, отрицательная — списание. */
  amount: number
  matchId?: number
  /** Идентификатор внешней операции. Повтор с тем же значением отклоняется. */
  externalId?: string
  adminId?: number
  comment?: string
  meta?: Record<string, unknown>
}

export class InsufficientFunds extends Error {
  constructor(readonly required: number, readonly available: number) {
    super(`недостаточно медяков: нужно ${required}, есть ${available}`)
    this.name = 'InsufficientFunds'
  }
}

export class DuplicateOperation extends Error {
  constructor(readonly externalId: string) {
    super(`операция ${externalId} уже проведена`)
    this.name = 'DuplicateOperation'
  }
}

/** Код нарушения уникальности в PostgreSQL. */
const UNIQUE_VIOLATION = '23505'

/**
 * Проводит операцию внутри уже открытой транзакции.
 * Строка игрока блокируется SELECT ... FOR UPDATE, поэтому два одновременных
 * списания не смогут увести баланс в минус.
 */
export async function postEntry(client: PoolClient, entry: LedgerEntry): Promise<number> {
  const { rows } = await client.query<{ coins_balance: number }>(
    'SELECT coins_balance FROM users WHERE id = $1 FOR UPDATE',
    [entry.userId],
  )
  if (rows.length === 0) throw new Error(`игрок ${entry.userId} не найден`)

  const balance = rows[0].coins_balance
  const next = balance + entry.amount

  if (next < 0) throw new InsufficientFunds(Math.abs(entry.amount), balance)

  try {
    await client.query(
      `INSERT INTO transactions
         (user_id, type, amount, balance_after, match_id, external_id, admin_id, comment, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.userId,
        entry.type,
        entry.amount,
        next,
        entry.matchId ?? null,
        entry.externalId ?? null,
        entry.adminId ?? null,
        entry.comment ?? null,
        JSON.stringify(entry.meta ?? {}),
      ],
    )
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === UNIQUE_VIOLATION) {
      // Сработала либо защита от повтора по external_id, либо «один ежедневный
      // бонус в сутки». В обоих случаях операцию проводить второй раз нельзя.
      throw new DuplicateOperation(entry.externalId ?? entry.type)
    }
    throw error
  }

  await client.query('UPDATE users SET coins_balance = $1, updated_at = now() WHERE id = $2', [
    next,
    entry.userId,
  ])

  return next
}

/** Проводит операцию в собственной транзакции. */
export async function post(entry: LedgerEntry): Promise<number> {
  return withTransaction((client) => postEntry(client, entry))
}

/**
 * Сверка: сходится ли баланс игрока с суммой его операций.
 * Нужна регулярной задаче и разбору спорных ситуаций.
 */
export async function reconcile(
  client: PoolClient,
  userId: number,
): Promise<{ balance: number; ledgerSum: number; matches: boolean }> {
  const { rows } = await client.query<{ balance: string; ledger_sum: string }>(
    `SELECT u.coins_balance::text AS balance,
            COALESCE(SUM(t.amount), 0)::text AS ledger_sum
       FROM users u
       LEFT JOIN transactions t ON t.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.coins_balance`,
    [userId],
  )
  const balance = Number(rows[0]?.balance ?? 0)
  const ledgerSum = Number(rows[0]?.ledger_sum ?? 0)
  return { balance, ledgerSum, matches: balance === ledgerSum }
}
