import { query } from '../db/client.js'

/**
 * Параметры экономики (ЧАСТЬ 6, п.5).
 *
 * Хранятся в таблице app_config и правятся из админки без пересборки.
 * Здесь — чтение с коротким кэшем в памяти: значения меняются редко,
 * а читаются на каждое открытие приложения.
 */

export interface EconomyConfig {
  coinsPerTon: number
  coinsPerStar: number
  minBet: number
  maxBet: number
  signupBonus: number
  dailyBonus: number
  referralInviterBonus: number
  referralInviteeBonus: number
  adReward: number
  withdrawMinCoins: number
  withdrawMinGames: number
  withdrawFeePercent: number
  eloK: number
  eloStart: number
  roundSeconds: number
  minReactionMs: number
}

const KEY_MAP: Record<keyof EconomyConfig, string> = {
  coinsPerTon: 'coins_per_ton',
  coinsPerStar: 'coins_per_star',
  minBet: 'min_bet',
  maxBet: 'max_bet',
  signupBonus: 'signup_bonus',
  dailyBonus: 'daily_bonus',
  referralInviterBonus: 'referral_inviter_bonus',
  referralInviteeBonus: 'referral_invitee_bonus',
  adReward: 'ad_reward',
  withdrawMinCoins: 'withdraw_min_coins',
  withdrawMinGames: 'withdraw_min_games',
  withdrawFeePercent: 'withdraw_fee_percent',
  eloK: 'elo_k',
  eloStart: 'elo_start',
  roundSeconds: 'round_seconds',
  minReactionMs: 'min_reaction_ms',
}

const CACHE_TTL_MS = 30_000
let cache: { value: EconomyConfig; at: number } | null = null

export async function getEconomyConfig(force = false): Promise<EconomyConfig> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM app_config')
  const byKey = new Map(rows.map((r) => [r.key, r.value]))

  const result = {} as EconomyConfig
  for (const [field, key] of Object.entries(KEY_MAP) as [keyof EconomyConfig, string][]) {
    const raw = byKey.get(key)
    if (raw === undefined) throw new Error(`в app_config нет параметра ${key}`)
    result[field] = Number(raw)
  }

  cache = { value: result, at: Date.now() }
  return result
}

/** Сбрасывает кэш — вызывается после правки параметров в админке. */
export function invalidateEconomyCache(): void {
  cache = null
}
