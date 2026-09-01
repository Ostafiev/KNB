import { queryOne } from '../db/client.js'
import { getEconomyConfig } from '../domain/appConfig.js'
import {
  expireRound,
  getMatch,
  openNextRound,
  type MatchRow,
  type MoveOutcome,
  type RoundRow,
} from '../domain/match.js'
import { buildMatchView, type MatchView } from '../domain/matchView.js'

/**
 * Живые соединения и часы раундов.
 *
 * Здесь и только здесь живёт таймер раунда. Клиент тоже рисует обратный
 * отсчёт, но он нужен исключительно для глаз: истечение времени объявляет
 * сервер, поэтому подкрутить часы на телефоне бесполезно.
 *
 * Реестр соединений в памяти процесса. Пока сервер один, этого достаточно.
 * Когда серверов станет несколько, сюда добавится рассылка через Redis —
 * остальной код об этом знать не должен.
 */

type Send = (payload: string) => void

interface Connection {
  userId: number
  send: Send
}

const connections = new Map<number, Set<Connection>>()
const roundTimers = new Map<number, NodeJS.Timeout>()

/**
 * Пауза между раундами: игроки видят, кто что показал, и только потом
 * начинается отсчёт следующего раунда. Без неё время на ход утекало бы
 * в экран результата.
 */
const RESULT_PAUSE_MS = 2500

/**
 * Кто-то должен узнать, что раунд открылся, помимо игроков: за бота ходит
 * сервер, и решение о фигуре принимается именно в этот момент. Хук вместо
 * прямого вызова — чтобы часы раундов ничего не знали про ботов.
 */
type RoundOpenHook = (match: MatchRow, round: RoundRow) => void
let roundOpenHook: RoundOpenHook | null = null

export function setRoundOpenHook(hook: RoundOpenHook): void {
  roundOpenHook = hook
}

export function registerConnection(userId: number, send: Send): () => void {
  const connection: Connection = { userId, send }
  let set = connections.get(userId)
  if (!set) {
    set = new Set()
    connections.set(userId, set)
  }
  set.add(connection)

  return () => {
    set!.delete(connection)
    if (set!.size === 0) connections.delete(userId)
  }
}

export function isOnline(userId: number): boolean {
  return (connections.get(userId)?.size ?? 0) > 0
}

export function sendToUser(userId: number, event: unknown): void {
  const set = connections.get(userId)
  if (!set) return
  const payload = JSON.stringify(event)
  for (const connection of set) {
    try {
      connection.send(payload)
    } catch {
      /* соединение уже закрыто — уборка произойдёт в обработчике close */
    }
  }
}

function playersOf(match: MatchRow): number[] {
  return match.player2_id === null ? [match.player1_id] : [match.player1_id, match.player2_id]
}

/** Рассылает каждому игроку матч с его точки зрения. */
export async function broadcastMatch(
  match: MatchRow,
  type: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  for (const userId of playersOf(match)) {
    const view = await buildMatchView(match, userId)
    const balance = await queryOne<{ coins_balance: number; rating: number }>(
      'SELECT coins_balance, rating FROM users WHERE id = $1',
      [userId],
    )
    sendToUser(userId, {
      type,
      match: view,
      balance: balance ? Number(balance.coins_balance) : undefined,
      rating: balance?.rating,
      ...extra,
    })
  }
}

// ─── Часы раунда ─────────────────────────────────────────────────────────────

export function clearRoundTimer(matchId: number): void {
  const timer = roundTimers.get(matchId)
  if (timer) {
    clearTimeout(timer)
    roundTimers.delete(matchId)
  }
}

/**
 * Заводит часы на раунд. Когда время выйдет, сервер сам закроет раунд:
 * не сходивший проигрывает, не сходили оба — ничья и переигровка.
 */
export async function armRoundTimer(match: MatchRow, round: RoundRow): Promise<number> {
  clearRoundTimer(match.id)

  const economy = await getEconomyConfig()
  const startedAt = new Date(round.started_at).getTime()
  const endsAt = startedAt + economy.roundSeconds * 1000

  // Небольшой запас на дорогу: ход, отправленный ровно в последнюю секунду,
  // должен успеть дойти.
  const delay = Math.max(0, endsAt - Date.now()) + 700

  const timer = setTimeout(() => {
    roundTimers.delete(match.id)
    void onRoundExpired(match.id, round.round_number)
  }, delay)

  // Часы раунда не должны держать процесс живым при остановке сервера.
  timer.unref?.()
  roundTimers.set(match.id, timer)

  return endsAt
}

async function onRoundExpired(matchId: number, roundNumber: number): Promise<void> {
  try {
    const outcome = await expireRound(matchId, roundNumber)
    if (!outcome) return
    await announceOutcome(outcome)
  } catch (error) {
    console.error('не удалось закрыть раунд по таймеру', error)
  }
}

// ─── Объявления ──────────────────────────────────────────────────────────────

export async function announceMatchStart(match: MatchRow, round: RoundRow): Promise<void> {
  const endsAt = await armRoundTimer(match, round)
  await broadcastMatch(match, 'match_found', { roundEndsAt: endsAt, roundNumber: round.round_number })
  roundOpenHook?.(match, round)
}

/** Соперник сходил. Фигуру не передаём — только сам факт. */
export function announceOpponentMoved(match: MatchRow, moverId: number, roundNumber: number): void {
  for (const userId of playersOf(match)) {
    if (userId === moverId) continue
    sendToUser(userId, { type: 'opponent_moved', matchId: match.id, roundNumber })
  }
}

export async function announceOutcome(outcome: MoveOutcome): Promise<void> {
  if (!outcome.resolved) return

  await broadcastMatch(outcome.match, 'round_result', { roundNumber: outcome.round.round_number })

  if (outcome.finished) {
    clearRoundTimer(outcome.match.id)
    await broadcastMatch(outcome.match, 'match_finished')
    return
  }

  if (outcome.continues) {
    scheduleNextRound(outcome.match.id)
  }
}

/** Открывает следующий раунд после паузы на показ результата. */
export function scheduleNextRound(matchId: number, delayMs = RESULT_PAUSE_MS): void {
  clearRoundTimer(matchId)
  const timer = setTimeout(() => {
    roundTimers.delete(matchId)
    void startNextRound(matchId)
  }, delayMs)
  timer.unref?.()
  roundTimers.set(matchId, timer)
}

async function startNextRound(matchId: number): Promise<void> {
  try {
    const opened = await openNextRound(matchId)
    if (!opened) return
    const endsAt = await armRoundTimer(opened.match, opened.round)
    await broadcastMatch(opened.match, 'round_started', {
      roundEndsAt: endsAt,
      roundNumber: opened.round.round_number,
    })
    roundOpenHook?.(opened.match, opened.round)
  } catch (error) {
    console.error('не удалось открыть следующий раунд', error)
  }
}

export async function announceMatchFinished(matchId: number): Promise<void> {
  clearRoundTimer(matchId)
  const match = await getMatch(matchId)
  if (match) await broadcastMatch(match, 'match_finished')
}

/**
 * Приглашение сдвинулось: кто-то отметился готовым.
 *
 * Обеим сторонам шлём одно и то же событие — приложение само решит, что
 * показать: окно «друг принял, играем?» хозяину или «ждём хозяина» гостю.
 */
export function announceInvite(userIds: number[], invite: unknown): void {
  for (const userId of userIds) {
    sendToUser(userId, { type: 'invite_update', invite })
  }
}

/** Текущее состояние матча одному игроку — после переподключения. */
export async function sendMatchState(matchId: number, userId: number): Promise<MatchView | null> {
  const match = await getMatch(matchId)
  if (!match) return null
  const view = await buildMatchView(match, userId)
  const economy = await getEconomyConfig()

  let roundEndsAt: number | undefined
  const open = view.rounds.find((r) => r.resolvedAt === null)
  if (open) roundEndsAt = new Date(open.startedAt).getTime() + economy.roundSeconds * 1000

  sendToUser(userId, { type: 'match_state', match: view, roundEndsAt })
  return view
}
