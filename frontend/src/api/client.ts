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
            body: {},
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

/** Идентификатор захода — склеивает события одной сессии. */
const sessionId = Math.random().toString(36).slice(2, 12)
