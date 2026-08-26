import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken, type MatchView } from '../api/client'
import { matchSocket, type SocketEvent } from '../api/socket'
import { useAppState } from './AppState'
import type { HandChoice } from '../types'

/**
 * Живой матч: подбор соперника, ходы и результаты приходят с сервера.
 *
 * Здесь нет ни одного игрового правила — счёт, победа и выплаты считаются
 * на сервере. Этот слой только показывает то, что сервер уже решил, и
 * отправляет наверх единственное решение игрока: какую фигуру он выбрал.
 *
 * Когда сервера нет (статичное превью), провайдер остаётся выключенным,
 * и приложение играет само с собой в демо-режиме.
 */

export type LivePhase = 'idle' | 'searching' | 'active' | 'finished'

/** Сигнал о событии — по нему экраны решают, куда переходить. */
export interface LiveSignal {
  kind: 'match_found' | 'round_result' | 'round_started' | 'match_finished' | 'error'
  seq: number
  code?: string
  message?: string
}

interface LiveMatchValue {
  /** Сервер на связи и матч можно играть по-настоящему. */
  available: boolean
  connected: boolean
  phase: LivePhase
  match: MatchView | null
  roundEndsAt: number | null
  opponentMoved: boolean
  myChoice: HandChoice | null
  signal: LiveSignal | null
  queue: (bet: number, rounds: number) => void
  cancelQueue: () => void
  createInvite: (input: {
    bet: number
    rounds: number
    condition?: string
  }) => Promise<{ match: MatchView; startParam: string }>
  join: (matchId: number) => Promise<MatchView>
  move: (choice: HandChoice) => void
  leave: () => void
  reset: () => void
}

const LiveMatchContext = createContext<LiveMatchValue | null>(null)

export function LiveMatchProvider({ children }: { children: React.ReactNode }) {
  const { status, refreshMe } = useAppState()
  const available = status === 'online'

  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState<LivePhase>('idle')
  const [match, setMatch] = useState<MatchView | null>(null)
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(null)
  const [opponentMoved, setOpponentMoved] = useState(false)
  const [myChoice, setMyChoice] = useState<HandChoice | null>(null)
  const [signal, setSignal] = useState<LiveSignal | null>(null)

  const seq = useRef(0)
  const matchIdRef = useRef<number | null>(null)
  // Фаза нужна внутри обработчика событий, который создаётся один раз.
  const phaseRef = useRef<LivePhase>('idle')
  phaseRef.current = phase

  const raise = useCallback((kind: LiveSignal['kind'], extra: Partial<LiveSignal> = {}) => {
    seq.current += 1
    setSignal({ kind, seq: seq.current, ...extra })
  }, [])

  /** Подхватывает свой ход из состояния матча — нужно после переподключения. */
  const adoptMatch = useCallback((view: MatchView) => {
    setMatch(view)
    matchIdRef.current = view.id
    const open = view.rounds.find((r) => r.resolvedAt === null)
    setMyChoice((open?.myChoice as HandChoice | null) ?? null)
    setOpponentMoved(open?.opponentMoved ?? false)
  }, [])

  useEffect(() => {
    if (!available) return
    const token = getToken()
    if (!token) return

    matchSocket.connect(token)

    const unsubscribe = matchSocket.subscribe((event: SocketEvent) => {
      switch (event.type) {
        case 'socket_open': {
          setConnected(true)
          // После обрыва спрашиваем, что стало с матчем, пока нас не было.
          if (matchIdRef.current) {
            matchSocket.send({ type: 'resume', matchId: matchIdRef.current })
          }
          return
        }

        case 'socket_closed':
          setConnected(false)
          return

        case 'queue_joined':
          setPhase('searching')
          return

        case 'queue_left':
          if (phaseRef.current === 'searching') setPhase('idle')
          return

        case 'match_found': {
          adoptMatch(event.match as MatchView)
          setRoundEndsAt((event.roundEndsAt as number) ?? null)
          setPhase('active')
          raise('match_found')
          return
        }

        case 'match_state': {
          const view = event.match as MatchView
          adoptMatch(view)
          setRoundEndsAt((event.roundEndsAt as number) ?? null)
          setPhase(view.finished ? 'finished' : 'active')
          return
        }

        case 'move_accepted':
          setMyChoice(event.choice as HandChoice)
          return

        case 'opponent_moved':
          setOpponentMoved(true)
          return

        case 'round_result': {
          setMatch(event.match as MatchView)
          raise('round_result')
          return
        }

        case 'round_started': {
          setMatch(event.match as MatchView)
          setRoundEndsAt((event.roundEndsAt as number) ?? null)
          setMyChoice(null)
          setOpponentMoved(false)
          raise('round_started')
          return
        }

        case 'match_finished': {
          setMatch(event.match as MatchView)
          setPhase('finished')
          setRoundEndsAt(null)
          // Баланс, рейтинг и статистику пересчитал сервер — забираем оттуда.
          void refreshMe()
          raise('match_finished')
          return
        }

        case 'error':
          raise('error', { code: event.code as string, message: event.message as string })
          return
      }
    })

    return () => {
      unsubscribe()
    }
  }, [available, adoptMatch, raise, refreshMe])

  const queue = useCallback((bet: number, rounds: number) => {
    setPhase('searching')
    setMatch(null)
    matchIdRef.current = null
    setMyChoice(null)
    setOpponentMoved(false)
    matchSocket.send({ type: 'queue', bet, rounds })
  }, [])

  const cancelQueue = useCallback(() => {
    matchSocket.send({ type: 'queue_cancel' })
    setPhase('idle')
  }, [])

  const createInvite = useCallback<LiveMatchValue['createInvite']>(async (input) => {
    const result = await api.createMatch({ mode: 'friend', ...input })
    setMatch(result.match)
    matchIdRef.current = result.match.id
    setPhase('searching')
    return result
  }, [])

  const join = useCallback<LiveMatchValue['join']>(async (matchId) => {
    const { match: view } = await api.joinMatch(matchId)
    adoptMatch(view)
    setPhase('active')
    return view
  }, [adoptMatch])

  const move = useCallback((choice: HandChoice) => {
    if (!matchIdRef.current) return
    setMyChoice(choice)
    matchSocket.send({ type: 'move', matchId: matchIdRef.current, choice })
  }, [])

  const leave = useCallback(() => {
    if (matchIdRef.current) {
      matchSocket.send({ type: 'leave', matchId: matchIdRef.current })
    } else {
      matchSocket.send({ type: 'queue_cancel' })
    }
    setPhase('idle')
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setMatch(null)
    matchIdRef.current = null
    setRoundEndsAt(null)
    setMyChoice(null)
    setOpponentMoved(false)
  }, [])

  const value = useMemo<LiveMatchValue>(
    () => ({
      available,
      connected,
      phase,
      match,
      roundEndsAt,
      opponentMoved,
      myChoice,
      signal,
      queue,
      cancelQueue,
      createInvite,
      join,
      move,
      leave,
      reset,
    }),
    [
      available,
      connected,
      phase,
      match,
      roundEndsAt,
      opponentMoved,
      myChoice,
      signal,
      queue,
      cancelQueue,
      createInvite,
      join,
      move,
      leave,
      reset,
    ],
  )

  return <LiveMatchContext.Provider value={value}>{children}</LiveMatchContext.Provider>
}

export function useLiveMatch(): LiveMatchValue {
  const ctx = useContext(LiveMatchContext)
  if (!ctx) throw new Error('useLiveMatch must be used within <LiveMatchProvider>')
  return ctx
}
