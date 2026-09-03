import { useCallback, useEffect, useState } from 'react'
import { api, type InviteView } from '../api/client'
import { useAppState } from './AppState'

/**
 * Свои приглашения, которые ещё ждут друга.
 *
 * Ожидание можно свернуть и заниматься чем угодно — приглашение живёт сутки
 * и никуда не денется. Но свёрнутое и невидимое — это почти потерянное:
 * человек забывает, кого позвал и на каких условиях, и зовёт заново или
 * бросает. Поэтому список висит на главной, пока есть что ждать.
 *
 * Раз в пятнадцать секунд: приглашения меняются редко, а вот момент, когда
 * друг наконец вошёл, лучше не проспать.
 */

const REFRESH_MS = 15_000

export function useMyInvites(): {
  invites: InviteView[]
  refresh: () => void
} {
  const { status } = useAppState()
  const live = status === 'online'

  const [invites, setInvites] = useState<InviteView[]>([])
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((v) => v + 1), [])

  useEffect(() => {
    if (!live) {
      setInvites([])
      return
    }

    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const { invites: list } = await api.getMyInvites()
        if (!cancelled) setInvites(list)
      } catch {
        /* связь моргнула — оставим прошлый список до следующей попытки */
      }
    }

    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [live, tick])

  return { invites, refresh }
}
