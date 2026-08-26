import { useEffect, useState } from 'react'
import { api, type MatchView } from '../api/client'
import { HAND_EMOJI } from '../lib/game'
import { RECENT_GAMES, type RecentGame } from '../data/mock'
import { useAppState } from './AppState'
import type { HandChoice } from '../types'

/**
 * Последние игры для главного экрана.
 *
 * На сервере — настоящие матчи игрока. Без сервера (статичное превью)
 * возвращаются демо-данные, чтобы витрина не выглядела пустой.
 */

function toRecent(match: MatchView): RecentGame {
  const lastRound = [...match.rounds].reverse().find((round) => round.myChoice !== null)
  const finishedAt = match.finishedAt ? new Date(match.finishedAt).getTime() : Date.now()

  return {
    opp: match.opponent?.nickname ?? '—',
    result: match.won ? 'win' : 'lose',
    delta: match.coinsDelta,
    hand: HAND_EMOJI[(lastRound?.myChoice ?? 'rock') as HandChoice],
    rounds: match.roundsTotal,
    minutesAgo: Math.max(0, Math.round((Date.now() - finishedAt) / 60_000)),
  }
}

export function useRecentGames(): { games: RecentGame[]; live: boolean } {
  const { status, stats } = useAppState()
  const [games, setGames] = useState<RecentGame[] | null>(null)

  useEffect(() => {
    if (status !== 'online') return
    let cancelled = false

    api
      .getMyMatches(10)
      .then(({ matches }) => {
        if (!cancelled) setGames(matches.map(toRecent))
      })
      .catch(() => {
        if (!cancelled) setGames([])
      })

    return () => {
      cancelled = true
    }
    // Счётчик сыгранных игр меняется после матча — это и есть сигнал обновиться.
  }, [status, stats.games])

  if (status === 'online') return { games: games ?? [], live: true }
  return { games: RECENT_GAMES, live: false }
}
