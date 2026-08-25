import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { queryOne, withTransaction } from '../db/client.js'
import { getEconomyConfig } from './appConfig.js'
import { postEntry, DuplicateOperation } from './ledger.js'
import type { TelegramUser } from '../telegram/initData.js'

export interface UserRow {
  id: number
  telegram_id: number
  telegram_username: string | null
  nickname: string
  avatar_id: string
  language: 'ru' | 'en'
  theme: 'dark' | 'light' | null
  sound_enabled: boolean
  rating: number
  games_played: number
  wins: number
  losses: number
  draws: number
  coins_balance: number
  referral_code: string
  referred_by: number | null
  last_daily_bonus_on: string | null
  consent_accepted_at: string | null
  banned_at: string | null
  created_at: string
}

/** Публичное представление игрока — то, что уходит в приложение. */
export interface PublicUser {
  id: number
  telegramId: number
  username: string | null
  nickname: string
  avatarId: string
  language: 'ru' | 'en'
  theme: 'dark' | 'light' | null
  soundEnabled: boolean
  rating: number
  balance: number
  stats: { games: number; wins: number; losses: number; draws: number }
  referralCode: string
  consentAccepted: boolean
  dailyBonusAvailable: boolean
  isNew: boolean
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export function toPublicUser(row: UserRow, isNew = false): PublicUser {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    username: row.telegram_username,
    nickname: row.nickname,
    avatarId: row.avatar_id,
    language: row.language,
    theme: row.theme,
    soundEnabled: row.sound_enabled,
    rating: row.rating,
    balance: Number(row.coins_balance),
    stats: {
      games: row.games_played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
    },
    referralCode: row.referral_code,
    consentAccepted: row.consent_accepted_at !== null,
    dailyBonusAvailable: row.last_daily_bonus_on !== todayUtc(),
    isNew,
  }
}

function displayName(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return name || user.username || `Игрок ${user.id}`
}

function newReferralCode(): string {
  return randomBytes(5).toString('hex')
}

export async function findByTelegramId(telegramId: number): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE telegram_id = $1', [telegramId])
}

/**
 * Находит игрока или заводит нового.
 *
 * Регистрация автоматическая (ЧАСТЬ 3, п.7): отдельной формы нет, профиль
 * собирается из данных Telegram. Новому игроку сразу начисляется
 * регистрационный бонус, а если он пришёл по реферальной ссылке —
 * ещё и стартовые от приглашения.
 */
export async function findOrCreate(
  telegramUser: TelegramUser,
  options: { startParam?: string; ip?: string } = {},
): Promise<{ user: UserRow; isNew: boolean }> {
  const existing = await findByTelegramId(telegramUser.id)
  if (existing) {
    // Данные в Telegram могли поменяться — подтягиваем их, но игровой ник
    // и аватар не трогаем: игрок мог задать свои.
    const updated = await queryOne<UserRow>(
      `UPDATE users
          SET telegram_username = $2,
              telegram_first_name = $3,
              telegram_last_name = $4,
              telegram_photo_url = $5,
              last_seen_at = now()
        WHERE id = $1
      RETURNING *`,
      [
        existing.id,
        telegramUser.username ?? null,
        telegramUser.first_name ?? null,
        telegramUser.last_name ?? null,
        telegramUser.photo_url ?? null,
      ],
    )
    return { user: updated ?? existing, isNew: false }
  }

  const economy = await getEconomyConfig()

  return withTransaction(async (client) => {
    // Повторная проверка внутри транзакции: два одновременных первых входа
    // с одного аккаунта не должны создать двух игроков.
    const raced = await client.query<UserRow>('SELECT * FROM users WHERE telegram_id = $1', [
      telegramUser.id,
    ])
    if (raced.rows.length > 0) return { user: raced.rows[0], isNew: false }

    const referrer = await resolveReferrer(client, options.startParam)

    const { rows } = await client.query<UserRow>(
      `INSERT INTO users
         (telegram_id, telegram_username, telegram_first_name, telegram_last_name,
          telegram_photo_url, nickname, language, referral_code, referred_by,
          rating, signup_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        telegramUser.id,
        telegramUser.username ?? null,
        telegramUser.first_name ?? null,
        telegramUser.last_name ?? null,
        telegramUser.photo_url ?? null,
        displayName(telegramUser),
        telegramUser.language_code?.startsWith('ru') ? 'ru' : 'en',
        newReferralCode(),
        referrer?.id ?? null,
        economy.eloStart,
        options.ip ?? null,
      ],
    )
    const user = rows[0]

    // Регистрационный бонус (ЧАСТЬ 5)
    await postEntry(client, {
      userId: user.id,
      type: 'signup_bonus',
      amount: economy.signupBonus,
      externalId: `signup:${user.id}`,
      comment: 'Бонус за регистрацию',
    })

    if (referrer) {
      await client.query(
        'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [referrer.id, user.id],
      )
      // Приглашённому — стартовые сразу. Пригласившему бонус придёт только
      // после первого матча приглашённого (этап 3).
      await postEntry(client, {
        userId: user.id,
        type: 'referral_signup',
        amount: economy.referralInviteeBonus,
        externalId: `referral_signup:${user.id}`,
        comment: `Пришёл по приглашению ${referrer.id}`,
      })
    }

    const fresh = await client.query<UserRow>('SELECT * FROM users WHERE id = $1', [user.id])
    return { user: fresh.rows[0], isNew: true }
  })
}

/** Разбирает start_param вида ref_<код> и находит пригласившего. */
async function resolveReferrer(
  client: PoolClient,
  startParam?: string,
): Promise<{ id: number } | null> {
  if (!startParam?.startsWith('ref_')) return null
  const code = startParam.slice(4)
  if (!code) return null

  const { rows } = await client.query<{ id: number }>(
    'SELECT id FROM users WHERE referral_code = $1 OR telegram_id::text = $1',
    [code],
  )
  return rows[0] ?? null
}

export interface ProfilePatch {
  nickname?: string
  avatarId?: string
  language?: 'ru' | 'en'
  theme?: 'dark' | 'light'
  soundEnabled?: boolean
}

export async function updateProfile(userId: number, patch: ProfilePatch): Promise<UserRow | null> {
  const fields: string[] = []
  const values: unknown[] = [userId]

  const add = (column: string, value: unknown): void => {
    values.push(value)
    fields.push(`${column} = $${values.length}`)
  }

  if (patch.nickname !== undefined) add('nickname', patch.nickname)
  if (patch.avatarId !== undefined) add('avatar_id', patch.avatarId)
  if (patch.language !== undefined) add('language', patch.language)
  if (patch.theme !== undefined) add('theme', patch.theme)
  if (patch.soundEnabled !== undefined) add('sound_enabled', patch.soundEnabled)

  if (fields.length === 0) return queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId])

  return queryOne<UserRow>(
    `UPDATE users SET ${fields.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    values,
  )
}

export async function acceptConsent(userId: number): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `UPDATE users
        SET consent_accepted_at = COALESCE(consent_accepted_at, now()), updated_at = now()
      WHERE id = $1
    RETURNING *`,
    [userId],
  )
}

/**
 * Ежедневный бонус (ЧАСТЬ 5).
 * Повтор в те же сутки отсекается уникальным индексом в базе, а не только
 * проверкой в коде — так его нельзя обойти двумя одновременными запросами.
 */
export async function claimDailyBonus(
  userId: number,
): Promise<{ granted: boolean; amount: number; balance: number }> {
  const economy = await getEconomyConfig()

  try {
    return await withTransaction(async (client) => {
      const balance = await postEntry(client, {
        userId,
        type: 'daily_bonus',
        amount: economy.dailyBonus,
        comment: 'Ежедневный бонус',
      })
      await client.query('UPDATE users SET last_daily_bonus_on = CURRENT_DATE WHERE id = $1', [
        userId,
      ])
      return { granted: true, amount: economy.dailyBonus, balance }
    })
  } catch (error) {
    if (error instanceof DuplicateOperation) {
      const row = await queryOne<{ coins_balance: number }>(
        'SELECT coins_balance FROM users WHERE id = $1',
        [userId],
      )
      return { granted: false, amount: 0, balance: Number(row?.coins_balance ?? 0) }
    }
    throw error
  }
}
