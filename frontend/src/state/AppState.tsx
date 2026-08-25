import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerStats } from '../types'
import { ECONOMY, applyServerEconomy } from '../config/economy'
import { BOT_USERNAME } from '../config/env'
import { getTelegramUser } from '../telegram/sdk'
import { api, ApiUnavailable, clearToken, type ServerUser } from '../api/client'
import { avatarEmoji } from '../data/mock'

/*
 * Состояние профиля и экономики.
 *
 * Работает в двух режимах.
 *   online  — сервер отвечает: он источник истины по балансу, рейтингу и бонусам.
 *   offline — сервера нет (статичное превью или обрыв связи): приложение живёт
 *             на локальных данных, как витрина. Так превью по ссылке
 *             продолжает работать, не требуя запущенного сервера.
 */

const STORAGE_KEY = 'knb.state.v1'

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

export interface ReferralState {
  invited: number
  pending: number
  earned: number
}

export interface AppStateShape {
  consentAccepted: boolean
  nickname: string
  avatarId: string
  telegramUsername: string
  telegramId: number
  referralCode: string
  rating: number
  balance: number
  stats: PlayerStats
  soundEnabled: boolean
  dailyBonusClaimedOn: string | null
  referral: ReferralState
}

const DEMO_STATE: AppStateShape = {
  consentAccepted: false,
  nickname: 'Никита Волков',
  avatarId: 'gamepad',
  telegramUsername: 'nikita_volkov',
  telegramId: 482910,
  referralCode: 'demo',
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

function loadLocalState(): AppStateShape {
  let base = DEMO_STATE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) base = { ...DEMO_STATE, ...(JSON.parse(raw) as Partial<AppStateShape>) }
  } catch {
    /* повреждённый или недоступный storage — берём демо-данные */
  }

  const tgUser = getTelegramUser()
  if (tgUser) {
    base = {
      ...base,
      telegramId: tgUser.id,
      telegramUsername: tgUser.username ?? base.telegramUsername,
      nickname:
        base.nickname === DEMO_STATE.nickname
          ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || base.nickname
          : base.nickname,
    }
  }
  return base
}

/** Приводит ответ сервера к внутреннему виду. */
function fromServer(user: ServerUser, previous: AppStateShape): AppStateShape {
  return {
    ...previous,
    consentAccepted: user.consentAccepted,
    nickname: user.nickname,
    avatarId: user.avatarId,
    telegramUsername: user.username ?? '',
    telegramId: user.telegramId,
    referralCode: user.referralCode,
    rating: user.rating,
    balance: user.balance,
    stats: user.stats,
    soundEnabled: user.soundEnabled,
    dailyBonusClaimedOn: user.dailyBonusAvailable ? null : todayKey(),
  }
}

interface AppStateValue extends AppStateShape {
  status: ConnectionStatus
  /** Эмодзи текущего аватара — идентификатор хранится, эмодзи показывается. */
  avatar: string
  dailyBonusAvailable: boolean
  withdrawUnlocked: boolean
  matchesToWithdraw: number
  referralLink: string
  acceptConsent: () => void
  claimDailyBonus: () => void
  rewardAd: () => void
  addBalance: (delta: number) => void
  setNickname: (name: string) => void
  setAvatar: (avatarId: string) => void
  setSoundEnabled: (enabled: boolean) => void
  recordMatch: (args: { outcome: 'win' | 'lose' | 'draw'; bet: number; ratingDelta: number }) => void
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppStateShape>(loadLocalState)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const online = status === 'online'
  // Чтобы обработчики не пересоздавались при каждой смене режима
  const onlineRef = useRef(false)
  onlineRef.current = online

  // Подключение к серверу при запуске
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [{ economy }, user] = await Promise.all([api.getConfig(), api.login()])
        if (cancelled) return
        applyServerEconomy(economy)
        setState((prev) => fromServer(user, prev))
        setStatus('online')
        void api.track('app_open', { isNew: user.isNew })
      } catch (error) {
        if (cancelled) return
        if (!(error instanceof ApiUnavailable)) {
          // Токен мог протухнуть или игрока забанили — начинаем с чистого листа
          clearToken()
        }
        setStatus('offline')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Локальная копия — чтобы приложение открывалось мгновенно до ответа сервера
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

  const acceptConsent = useCallback(() => {
    patch({ consentAccepted: true })
    if (onlineRef.current) {
      void api.acceptConsent().catch(() => {
        /* согласие уже отмечено локально, сервер догонит при следующем входе */
      })
    }
  }, [patch])

  const addBalance = useCallback(
    (delta: number) => setState((prev) => ({ ...prev, balance: Math.max(0, prev.balance + delta) })),
    [],
  )

  const claimDailyBonus = useCallback(() => {
    if (onlineRef.current) {
      void api
        .claimDailyBonus()
        .then((result) => {
          if (result.granted) {
            setState((prev) => ({
              ...prev,
              balance: result.balance,
              dailyBonusClaimedOn: todayKey(),
            }))
            void api.track('daily_bonus_claimed', { amount: result.amount })
          } else {
            setState((prev) => ({ ...prev, dailyBonusClaimedOn: todayKey() }))
          }
        })
        .catch(() => {})
      return
    }

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
    // TODO(этап 6): начисление подтверждает сервер по колбэку рекламной сети.
    setState((prev) => ({ ...prev, balance: prev.balance + ECONOMY.AD_REWARD }))
    void api.track('ad_watched', { amount: ECONOMY.AD_REWARD })
  }, [])

  const recordMatch = useCallback<AppStateValue['recordMatch']>(({ outcome, bet, ratingDelta }) => {
    // TODO(этап 4): результат матча считает сервер, здесь останется только отрисовка.
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

  const setNickname = useCallback(
    (nickname: string) => {
      patch({ nickname })
      if (onlineRef.current) void api.patchMe({ nickname }).catch(() => {})
    },
    [patch],
  )

  const setAvatar = useCallback(
    (avatarId: string) => {
      patch({ avatarId })
      if (onlineRef.current) void api.patchMe({ avatarId }).catch(() => {})
    },
    [patch],
  )

  const setSoundEnabled = useCallback(
    (soundEnabled: boolean) => {
      patch({ soundEnabled })
      if (onlineRef.current) void api.patchMe({ soundEnabled }).catch(() => {})
    },
    [patch],
  )

  const value = useMemo<AppStateValue>(() => {
    const matchesToWithdraw = Math.max(0, ECONOMY.WITHDRAW_MIN_GAMES - state.stats.games)
    return {
      ...state,
      status,
      avatar: avatarEmoji(state.avatarId),
      dailyBonusAvailable: state.dailyBonusClaimedOn !== todayKey(),
      withdrawUnlocked: matchesToWithdraw === 0 && state.balance >= ECONOMY.WITHDRAW_MIN_COINS,
      matchesToWithdraw,
      referralLink: `https://t.me/${BOT_USERNAME}?start=ref_${state.referralCode}`,
      acceptConsent,
      claimDailyBonus,
      rewardAd,
      addBalance,
      setNickname,
      setAvatar,
      setSoundEnabled,
      recordMatch,
    }
  }, [
    state,
    status,
    acceptConsent,
    claimDailyBonus,
    rewardAd,
    addBalance,
    setNickname,
    setAvatar,
    setSoundEnabled,
    recordMatch,
  ])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within <AppStateProvider>')
  return ctx
}
