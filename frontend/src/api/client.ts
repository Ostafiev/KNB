import { ALLOW_DEV_LOGIN, API_BASE_URL } from '../config/env'
import { getInitData, getStartParam } from '../telegram/sdk'
import type { Lang, PlayerStats, Theme } from '../types'

/**
 * Клиент серверного API.
 *
 * Если сервера нет — например, приложение открыто как статичное превью —
 * все методы бросают ApiUnavailable, а приложение продолжает работать
 * на локальных данных. Витрину это не ломает.
 */

const TOKEN_KEY = 'knb.token'

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiUnavailable extends Error {
  constructor(message = 'сервер недоступен') {
    super(message)
    this.name = 'ApiUnavailable'
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* приватный режим — токен проживёт до перезагрузки */
  }
}

export function getToken(): string | null {
  return readToken()
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* no-op */
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  if (options.auth !== false) {
    const token = readToken()
    if (token) headers.authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiUnavailable()
  }

  if (!response.ok) {
    let code = 'error'
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      code = body.error ?? code
      message = body.message ?? message
    } catch {
      /* ответ без тела */
    }
    throw new ApiError(response.status, code, message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

// ─── Типы ответов ────────────────────────────────────────────────────────────

export interface ServerUser {
  id: number
  telegramId: number
  username: string | null
  nickname: string
  avatarId: string
  language: Lang
  theme: Theme | null
  soundEnabled: boolean
  rating: number
  balance: number
  stats: PlayerStats
  referralCode: string
  consentAccepted: boolean
  dailyBonusAvailable: boolean
  isNew: boolean
}

export interface ServerEconomy {
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

/** Раунд глазами игрока. Чужая фигура появляется только вместе с результатом. */
export interface RoundView {
  number: number
  display: number
  myChoice: 'rock' | 'scissors' | 'paper' | null
  opponentChoice: 'rock' | 'scissors' | 'paper' | null
  opponentMoved: boolean
  result: 'win' | 'loss' | 'draw' | null
  myTimedOut: boolean
  opponentTimedOut: boolean
  startedAt: string
  resolvedAt: string | null
}

export interface MatchPlayerView {
  id: number
  nickname: string
  avatarId: string
  rating: number
}

/** Матч глазами игрока — всё уже пересчитано сервером под него. */
export interface MatchView {
  id: number
  mode: 'random' | 'friend'
  status: string
  bet: number
  roundsTotal: number
  winsNeeded: number
  condition: string | null
  me: MatchPlayerView
  opponent: MatchPlayerView | null
  myScore: number
  opponentScore: number
  currentRound: number
  rounds: RoundView[]
  finished: boolean
  won: boolean | null
  ratingDelta: number
  coinsDelta: number
  opponentLeft: boolean
  iLeft: boolean
  startedAt: string | null
  finishedAt: string | null
}

/** Бой, который ждёт соперника прямо сейчас. */
export interface OpenMatchView {
  id: number
  bet: number
  rounds: number
  condition: string | null
  createdAt: string
  host: { id: number; nickname: string; avatarId: string; rating: number }
}

export interface TransactionView {
  id: number
  type: string
  amount: number
  balanceAfter: number
  comment: string | null
  createdAt: string
}

export interface ReferralSummaryView {
  invited: number
  paid: number
  pending: number
  earned: number
  friends: { id: number; nickname: string; avatarId: string; bonusPaid: boolean; joinedAt: string }[]
}

// ─── Методы ──────────────────────────────────────────────────────────────────

export const api = {
  /**
   * Вход. Внутри Telegram — по подписанной initData; в обычном браузере
   * во время разработки — по служебному маршруту, которого нет в релизе.
   */
  async login(): Promise<ServerUser> {
    const initData = getInitData()

    const result = initData
      ? await request<{ token: string; user: ServerUser }>('/auth/telegram', {
          method: 'POST',
          auth: false,
          body: { initData },
        })
      : ALLOW_DEV_LOGIN
        ? await request<{ token: string; user: ServerUser }>('/auth/dev', {
            method: 'POST',
            auth: false,
            body: devIdentity(),
          })
        : (() => {
            throw new ApiUnavailable('приложение открыто вне Telegram')
          })()

    writeToken(result.token)
    return result.user
  },

  getConfig(): Promise<{ economy: ServerEconomy }> {
    return request('/config', { auth: false })
  },

  getMe(): Promise<{ user: ServerUser }> {
    return request('/me')
  },

  patchMe(patch: {
    nickname?: string
    avatarId?: string
    language?: Lang
    theme?: Theme
    soundEnabled?: boolean
  }): Promise<{ user: ServerUser }> {
    return request('/me', { method: 'PATCH', body: patch })
  },

  acceptConsent(): Promise<{ user: ServerUser }> {
    return request('/me/consent', { method: 'POST' })
  },

  claimDailyBonus(): Promise<{ granted: boolean; amount: number; balance: number }> {
    return request('/me/daily-bonus', { method: 'POST' })
  },

  /** Приглашение другу: матч ждёт второго игрока по ссылке. */
  createMatch(input: {
    mode: 'random' | 'friend'
    bet: number
    rounds: number
    condition?: string
  }): Promise<{ match: MatchView; startParam: string }> {
    return request('/matches', { method: 'POST', body: input })
  },

  getOpenMatches(filter: { bet?: number; rounds?: number } = {}): Promise<{
    matches: OpenMatchView[]
  }> {
    const params = new URLSearchParams()
    if (filter.bet !== undefined) params.set('bet', String(filter.bet))
    if (filter.rounds !== undefined) params.set('rounds', String(filter.rounds))
    const query = params.toString()
    return request(`/matches/open${query ? `?${query}` : ''}`)
  },

  joinMatch(matchId: number): Promise<{ match: MatchView }> {
    return request(`/matches/${matchId}/join`, { method: 'POST' })
  },

  getMatch(matchId: number): Promise<{ match?: MatchView; invite?: unknown }> {
    return request(`/matches/${matchId}`)
  },

  leaveMatch(matchId: number): Promise<{ match?: MatchView }> {
    return request(`/matches/${matchId}/leave`, { method: 'POST' })
  },

  getMyMatches(limit = 10): Promise<{ matches: MatchView[] }> {
    return request(`/me/matches?limit=${limit}`)
  },

  getTransactions(limit = 50): Promise<{ transactions: TransactionView[] }> {
    return request(`/me/transactions?limit=${limit}`)
  },

  getReferrals(): Promise<ReferralSummaryView> {
    return request('/me/referrals')
  },

  /** Отправка событий. Ошибки глотаются: аналитика не должна ломать игру. */
  async track(name: string, props?: Record<string, unknown>): Promise<void> {
    try {
      await request('/events', { method: 'POST', body: { events: [{ name, props, sessionId }] } })
    } catch {
      /* no-op */
    }
  },

  /** Реферальная ссылка, если сервер сообщил код приглашения. */
  startParam: getStartParam(),
}

/**
 * Кто входит служебным маршрутом.
 *
 * По умолчанию — один и тот же тестовый игрок. Чтобы открыть двух разных
 * игроков в двух окнах и сыграть матч между ними, достаточно добавить к
 * адресу `?dev=2`: номер запоминается и дальше подставляется сам.
 */
function devIdentity(): { telegramId: number; name: string } {
  let slot = 1
  try {
    const fromUrl = new URLSearchParams(location.search).get('dev')
    if (fromUrl) {
      slot = Math.max(1, Number(fromUrl) || 1)
      localStorage.setItem('knb.devSlot', String(slot))
    } else {
      slot = Number(localStorage.getItem('knb.devSlot')) || 1
    }
  } catch {
    /* приватный режим — остаёмся первым игроком */
  }
  return { telegramId: 999_000_000 + slot, name: `Тестовый игрок ${slot}` }
}

/** Идентификатор захода — склеивает события одной сессии. */
const sessionId = Math.random().toString(36).slice(2, 12)
