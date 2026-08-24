import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { PlayerStats } from '../types'
import { ECONOMY } from '../config/economy'
import { BOT_USERNAME } from '../config/env'
import { getTelegramUser } from '../telegram/sdk'

/*
 * Локальное состояние профиля и экономики.
 *
 * TODO(backend): после появления API (ЧАСТЬ 3) это должно стать тонким кэшем над
 * GET /api/me. Сервер — единственный источник истины по балансу, рейтингу,
 * ежедневному бонусу и реферальным начислениям; localStorage остаётся только
 * для мгновенной отрисовки до первого ответа сервера.
 */

const STORAGE_KEY = 'knb.state.v1'

export interface ReferralState {
  /** Сколько человек перешло по ссылке. */
  invited: number
  /** Из них ещё не сыграли первый матч — бонус не начислен. */
  pending: number
  /** Сколько медяков уже начислено за рефералов. */
  earned: number
}

export interface AppStateShape {
  /** Экран согласия пройден (ЧАСТЬ 2, п.13). */
  consentAccepted: boolean
  nickname: string
  avatar: string
  telegramUsername: string
  telegramId: number
  rating: number
  balance: number
  stats: PlayerStats
  soundEnabled: boolean
  /** ISO-дата (YYYY-MM-DD) последнего забранного ежедневного бонуса. */
  dailyBonusClaimedOn: string | null
  referral: ReferralState
}

const DEFAULT_STATE: AppStateShape = {
  consentAccepted: false,
  nickname: 'Никита Волков',
  avatar: '🎮',
  telegramUsername: 'nikita_volkov',
  telegramId: 482910,
  rating: 1840,
  balance: 1240,
  stats: { games: 318, wins: 204, losses: 89, draws: 25 },
  soundEnabled: true,
  dailyBonusClaimedOn: null,
  referral: { invited: 4, pending: 1, earned: 300 },
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadState(): AppStateShape {
  let base = DEFAULT_STATE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) base = { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<AppStateShape>) }
  } catch {
    /* повреждённый или недоступный storage — молча берём дефолт */
  }
  // Подставляем реальные данные Telegram, если приложение открыто внутри клиента.
  const tgUser = getTelegramUser()
  if (tgUser) {
    base = {
      ...base,
      telegramId: tgUser.id,
      telegramUsername: tgUser.username ?? base.telegramUsername,
      nickname:
        base.nickname === DEFAULT_STATE.nickname
          ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || base.nickname
          : base.nickname,
    }
  }
  return base
}

interface AppStateValue extends AppStateShape {
  /** Ежедневный бонус ещё не забран сегодня. */
  dailyBonusAvailable: boolean
  /** Вывод разблокирован: сыграно достаточно матчей и хватает баланса. */
  withdrawUnlocked: boolean
  /** Сколько матчей осталось до разблокировки вывода. */
  matchesToWithdraw: number
  /** Персональная реферальная ссылка. */
  referralLink: string
  acceptConsent: () => void
  claimDailyBonus: () => void
  /** Начислить награду за просмотр rewarded-рекламы. */
  rewardAd: () => void
  addBalance: (delta: number) => void
  setNickname: (name: string) => void
  setAvatar: (avatar: string) => void
  setSoundEnabled: (enabled: boolean) => void
  /** Записать результат матча — баланс, рейтинг и статистика. */
  recordMatch: (args: { outcome: 'win' | 'lose' | 'draw'; bet: number; ratingDelta: number }) => void
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppStateShape>(loadState)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* no-op */
    }
  }, [state])

  const patch = useCallback((next: Partial<AppStateShape>) => {
    setState((prev) => ({ ...prev, ...next }))
  }, [])

  const acceptConsent = useCallback(() => patch({ consentAccepted: true }), [patch])

  const addBalance = useCallback(
    (delta: number) => setState((prev) => ({ ...prev, balance: Math.max(0, prev.balance + delta) })),
    [],
  )

  const claimDailyBonus = useCallback(() => {
    // TODO(backend): POST /api/bonus/daily — начисление и защита от повторов на сервере.
    setState((prev) => {
      if (prev.dailyBonusClaimedOn === todayKey()) return prev
      return {
        ...prev,
        balance: prev.balance + ECONOMY.DAILY_BONUS,
        dailyBonusClaimedOn: todayKey(),
      }
    })
  }, [])

  const rewardAd = useCallback(() => {
    // TODO(monetization): заменить на колбэк успешного просмотра из SDK
    // (AdsGram / HilltopAds / Monetag) + подтверждение начисления на сервере.
    setState((prev) => ({ ...prev, balance: prev.balance + ECONOMY.AD_REWARD }))
  }, [])

  const recordMatch = useCallback<AppStateValue['recordMatch']>(({ outcome, bet, ratingDelta }) => {
    setState((prev) => ({
      ...prev,
      balance: prev.balance + (outcome === 'win' ? bet : outcome === 'lose' ? -bet : 0),
      rating: prev.rating + ratingDelta,
      stats: {
        games: prev.stats.games + 1,
        wins: prev.stats.wins + (outcome === 'win' ? 1 : 0),
        losses: prev.stats.losses + (outcome === 'lose' ? 1 : 0),
        draws: prev.stats.draws + (outcome === 'draw' ? 1 : 0),
      },
    }))
  }, [])

  const value = useMemo<AppStateValue>(() => {
    const matchesToWithdraw = Math.max(0, ECONOMY.WITHDRAW_MIN_GAMES - state.stats.games)
    return {
      ...state,
      dailyBonusAvailable: state.dailyBonusClaimedOn !== todayKey(),
      withdrawUnlocked: matchesToWithdraw === 0 && state.balance >= ECONOMY.WITHDRAW_MIN_COINS,
      matchesToWithdraw,
      referralLink: `https://t.me/${BOT_USERNAME}?start=ref_${state.telegramId}`,
      acceptConsent,
      claimDailyBonus,
      rewardAd,
      addBalance,
      setNickname: (nickname: string) => patch({ nickname }),
      setAvatar: (avatar: string) => patch({ avatar }),
      setSoundEnabled: (soundEnabled: boolean) => patch({ soundEnabled }),
      recordMatch,
    }
  }, [state, acceptConsent, claimDailyBonus, rewardAd, addBalance, patch, recordMatch])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within <AppStateProvider>')
  return ctx
}
