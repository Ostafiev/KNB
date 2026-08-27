import { useCallback, useEffect, useState } from 'react'
import { api, type FriendView } from '../api/client'
import { useAppState } from './AppState'

/**
 * Список друзей с сервера.
 *
 * Telegram не отдаёт контакты никому, поэтому «друзья» здесь — это люди,
 * с которыми у игрока есть общая история: пришли по его ссылке, пригласили
 * его самого или играли с ним. Каждая строка помнит, откуда взялась.
 *
 * Обновляется раз в десять секунд: важно в первую очередь то, кто сейчас
 * у экрана — позвать на бой можно только его.
 */

const REFRESH_MS = 10_000

export function useFriends(): {
  friends: FriendView[]
  live: boolean
  loading: boolean
  refresh: () => void
} {
  const { status } = useAppState()
  const live = status === 'online'

  const [friends, setFriends] = useState<FriendView[]>([])
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
        const { friends: list } = await api.getFriends()
        if (!cancelled) setFriends(list)
      } catch {
        /* связь моргнула — оставим прошлый список до следующей попытки */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [live, tick])

  return { friends, live, loading, refresh }
}
