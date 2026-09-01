import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken, type ChallengeView, type InviteView, type MatchView } from '../api/client'
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

/** Что случилось с отправленным вызовом. */
export type ChallengeOutcome = 'declined' | 'expired' | 'cancelled'

/** Сигнал о событии — по нему экраны решают, куда переходить. */
export interface LiveSignal {
  kind:
    | 'match_found'
    | 'round_result'
    | 'round_started'
    | 'match_finished'
    | 'error'
    | 'challenge_sent'
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
  /** Вызовы, на которые ждут моего ответа. */
  incoming: ChallengeView[]
  /** Мой вызов, ждущий ответа друга. */
  outgoing: ChallengeView | null
  /** Что стало с последним отправленным вызовом — для короткого сообщения. */
  challengeOutcome: { outcome: ChallengeOutcome; seq: number } | null
  challenge: (input: {
    toUserId: number
    bet: number
    rounds: number
    condition?: string
  }) => void
  acceptChallenge: (matchId: number) => void
  declineChallenge: (matchId: number) => void
  cancelChallenge: (matchId: number) => void
  queue: (bet: number, rounds: number) => void
  cancelQueue: () => void
  createInvite: (input: {
    bet: number
    rounds: number
    condition?: string
  }) => Promise<{ match: MatchView; startParam: string }>
  /** Вход по ссылке. Вернёт null, если хозяина нет и бой ещё не начался. */
  join: (matchId: number) => Promise<MatchView | null>
  /** Мой идентификатор на сервере — чтобы понять, кто в приглашении кто. */
  myId: number | null
  /** Приглашение, которое ждёт ответа именно сейчас. */
  invite: InviteView | null
  /** Я принял приглашение, но второго нет — ждём встречи. */
  waitingForInvite: InviteView | null
  inviteReady: (matchId: number) => void
  inviteLater: (matchId: number) => void
  inviteRelease: (matchId: number) => void
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
  const [incoming, setIncoming] = useState<ChallengeView[]>([])
  const [outgoing, setOutgoing] = useState<ChallengeView | null>(null)
  const [challengeOutcome, setChallengeOutcome] = useState<
    { outcome: ChallengeOutcome; seq: number } | null
  >(null)
  const [myId, setMyId] = useState<number | null>(null)
  const [invite, setInvite] = useState<InviteView | null>(null)
  const [waitingForInvite, setWaitingForInvite] = useState<InviteView | null>(null)

  const seq = useRef(0)
  const bump = useRef(0)
  const myIdRef = useRef<number | null>(null)
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
        case 'hello': {
          const id = (event.userId as number) ?? null
          myIdRef.current = id
          setMyId(id)
          return
        }

        case 'socket_open': {
          setConnected(true)
          // После обрыва спрашиваем, что стало с матчем, пока нас не было.
          if (matchIdRef.current) {
            matchSocket.send({ type: 'resume', matchId: matchIdRef.current })
          }
          // И какие вызовы ещё ждут ответа: окно должно вернуться на место.
          matchSocket.send({ type: 'challenges' })
          matchSocket.send({ type: 'invites' })
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
          // Бой начался — окна вызовов и приглашений больше не нужны.
          setIncoming([])
          setOutgoing(null)
          setInvite(null)
          setWaitingForInvite(null)
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

        // ─── Вызовы ────────────────────────────────────────────────────────

        case 'challenges': {
          setIncoming((event.incoming as ChallengeView[]) ?? [])
          setOutgoing(((event.outgoing as ChallengeView[]) ?? [])[0] ?? null)
          return
        }

        case 'invite_update': {
          const view = event.invite as InviteView
          const meIsHost = view.host.id === myIdRef.current

          /*
           * Хозяину показываем окно «друг принял вызов» — но только когда
           * друг действительно ждёт. Гостю — что хозяин вернулся.
           */
          if (meIsHost ? view.guestReady && !view.hostReady : view.hostReady && !view.guestReady) {
            setInvite(view)
          } else {
            setInvite(null)
          }

          // Я отметился готовым, а второго нет — значит жду встречи.
          const myReady = meIsHost ? view.hostReady : view.guestReady
          const otherReady = meIsHost ? view.guestReady : view.hostReady
          setWaitingForInvite(myReady && !otherReady ? view : null)
          return
        }

        case 'challenge_received': {
          const challenge = event.challenge as ChallengeView
          setIncoming((prev) => [
            ...prev.filter((c) => c.matchId !== challenge.matchId),
            challenge,
          ])
          return
        }

        case 'challenge_sent': {
          setOutgoing(event.challenge as ChallengeView)
          raise('challenge_sent')
          return
        }

        case 'challenge_declined':
        case 'challenge_expired':
        case 'challenge_cancelled':
        case 'challenge_closed': {
          const matchId = event.matchId as number
          setIncoming((prev) => prev.filter((c) => c.matchId !== matchId))
          setOutgoing((prev) => {
            if (prev?.matchId !== matchId) return prev
            if (event.type !== 'challenge_closed') {
              bump.current += 1
              setChallengeOutcome({
                outcome:
                  event.type === 'challenge_declined'
                    ? 'declined'
                    : event.type === 'challenge_expired'
                      ? 'expired'
                      : 'cancelled',
                seq: bump.current,
              })
            }
            return null
          })
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

  /**
   * Позвать друга на бой. Ставка сейчас не списывается: медяки уходят
   * только когда друг ответит согласием и оба окажутся в бою.
   */
  const challenge = useCallback<LiveMatchValue['challenge']>((input) => {
    matchSocket.send({
      type: 'challenge',
      toUserId: input.toUserId,
      bet: input.bet,
      rounds: input.rounds,
      condition: input.condition?.trim() || undefined,
    })
  }, [])

  const acceptChallenge = useCallback((matchId: number) => {
    setIncoming((prev) => prev.filter((c) => c.matchId !== matchId))
    matchSocket.send({ type: 'challenge_accept', matchId })
  }, [])

  const declineChallenge = useCallback((matchId: number) => {
    setIncoming((prev) => prev.filter((c) => c.matchId !== matchId))
    matchSocket.send({ type: 'challenge_decline', matchId })
  }, [])

  const cancelChallenge = useCallback((matchId: number) => {
    setOutgoing(null)
    matchSocket.send({ type: 'challenge_cancel', matchId })
  }, [])

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

  const join = useCallback<LiveMatchValue['join']>(
    async (matchId) => {
      const result = await api.joinMatch(matchId)

      // Хозяина нет на связи: бой не начался, зовём его и ждём встречи.
      if (result.waiting || !result.match) {
        setWaitingForInvite(result.invite ?? null)
        return null
      }

      adoptMatch(result.match)
      setPhase('active')
      return result.match
    },
    [adoptMatch],
  )

  const inviteReady = useCallback((matchId: number) => {
    setInvite(null)
    matchSocket.send({ type: 'invite_ready', matchId })
  }, [])

  const inviteLater = useCallback((matchId: number) => {
    setInvite(null)
    matchSocket.send({ type: 'invite_later', matchId })
  }, [])

  const inviteRelease = useCallback((matchId: number) => {
    setWaitingForInvite(null)
    matchSocket.send({ type: 'invite_release', matchId })
  }, [])

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
      incoming,
      outgoing,
      challengeOutcome,
      challenge,
      acceptChallenge,
      declineChallenge,
      cancelChallenge,
      myId,
      invite,
      waitingForInvite,
      inviteReady,
      inviteLater,
      inviteRelease,
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
      incoming,
      outgoing,
      challengeOutcome,
      challenge,
      acceptChallenge,
      declineChallenge,
      cancelChallenge,
      myId,
      invite,
      waitingForInvite,
      inviteReady,
      inviteLater,
      inviteRelease,
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
