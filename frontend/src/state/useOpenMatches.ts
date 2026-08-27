import { useCallback, useEffect, useState } from 'react'
import { api, type OpenMatchView } from '../api/client'
import { avatarEmoji } from '../data/mock'
import { useAppState } from './AppState'
import type { Player } from '../types'

/**
 * Открытые бои — те, что прямо сейчас ждут соперника.
 *
 * Раньше на этом экране был выдуманный список игроков, и созданный бой
 * в нём не появлялся: заявка жила невидимой очередью. Теперь список
 * настоящий, и всё, что в нём видно, можно нажать и сыграть.
 *
 * Обновляется раз в три секунды: чужой бой мог появиться или уйти,
 * пока игрок смотрит на экран.
 */

const REFRESH_MS = 5000

/** Открытый бой в виде карточки игрока — так его рисует существующий список. */
function toPlayer(match: OpenMatchView): Player & { matchId: number } {
  return {
    id: match.id,
    matchId: match.id,
    name: match.host.nickname,
    avatar: avatarEmoji(match.host.avatarId),
    rating: match.host.rating,
    bet: match.bet,
    rounds: match.rounds,
    online: true,
  }
}

export function useOpenMatches(): {
  players: (Player & { matchId: number })[]
  live: boolean
  loading: boolean
  refresh: () => void
} {
  const { status } = useAppState()
  const live = status === 'online'

  const [players, setPlayers] = useState<(Player & { matchId: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((v) => v + 1), [])

  useEffect(() => {
    if (!live) {
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const { matches } = await api.getOpenMatches()
        if (!cancelled) setPlayers(matches.map(toPlayer))
      } catch {
        /* связь моргнула — оставим прошлый список до следующей попытки */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    /*
     * Пока приложение свёрнуто, опрашивать сервер незачем: это тратит
     * связь и батарею, а список всё равно никто не видит.
     */
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [live, tick])

  return { players, live, loading, refresh }
}
