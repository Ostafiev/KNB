import type { FastifyInstance } from 'fastify'
import { getEconomyConfig } from '../domain/appConfig.js'
import {
  chooseFigure,
  getBotSettings,
  isKnownBot,
  refreshBotIds,
  refreshStaleMatches,
  thinkingDelayMs,
  topUpOpenMatches,
} from '../domain/bots.js'
import { recordMove, MatchError, type MatchRow, type RoundRow } from '../domain/match.js'
import { announceOutcome, announceOpponentMoved, setRoundOpenHook } from './hub.js'

/**
 * Жизнь ботов на сервере.
 *
 * Две обязанности. Первая — держать в списке несколько открытых боёв, чтобы
 * игрок, зашедший в одиночестве, нашёл соперника, а не пустой экран. Вторая —
 * ходить за бота в начавшемся матче.
 *
 * Фигура выбирается в момент открытия раунда и не меняется. Отправляется она
 * позже, через человеческую паузу, но решение к тому моменту уже принято:
 * подглядеть чужой ход бот не может, потому что чужого хода ещё нет.
 */

const TICK_MS = 20_000

const pending = new Map<string, NodeJS.Timeout>()

export function isBotId(userId: number): boolean {
  return isKnownBot(userId)
}

function key(matchId: number, roundNumber: number, userId: number): string {
  return `${matchId}:${roundNumber}:${userId}`
}

/**
 * Раунд открылся. Если в матче есть бот — он прямо сейчас решает, что покажет,
 * и отправит это решение через паузу.
 */
async function onRoundOpen(match: MatchRow, round: RoundRow): Promise<void> {
  const players = [match.player1_id, match.player2_id].filter(
    (id): id is number => id !== null && isKnownBot(id),
  )
  if (players.length === 0) return

  const [settings, economy] = await Promise.all([getBotSettings(), getEconomyConfig()])

  for (const botId of players) {
    // Решение принимается здесь и сейчас — до любого хода соперника.
    const choice = chooseFigure()
    const delay = thinkingDelayMs(settings, economy.roundSeconds)
    const id = key(match.id, round.round_number, botId)

    const existing = pending.get(id)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      pending.delete(id)
      void (async () => {
        try {
          const outcome = await recordMove(match.id, botId, choice)
          if (!outcome.resolved) {
            announceOpponentMoved(outcome.match, botId, outcome.round.round_number)
            return
          }
          await announceOutcome(outcome)
        } catch (error) {
          /*
           * Раунд мог закрыться раньше: соперник вышел или истекло время.
           * Это нормальный ход событий, а не сбой.
           */
          if (!(error instanceof MatchError)) {
            console.error('бот не смог сходить', error)
          }
        }
      })()
    }, delay)

    timer.unref?.()
    pending.set(id, timer)
  }
}

/** Периодическая работа: обновить список ботов и пополнить открытые бои. */
async function tick(app: FastifyInstance): Promise<void> {
  try {
    await refreshBotIds()

    const settings = await getBotSettings()
    if (!settings.enabled) return

    await refreshStaleMatches()
    const created = await topUpOpenMatches(settings)
    if (created > 0) app.log.debug(`боты открыли боёв: ${created}`)
  } catch (error) {
    app.log.error({ err: error }, 'не удалось обновить ботов')
  }
}

export async function startBotRuntime(app: FastifyInstance): Promise<void> {
  setRoundOpenHook((match, round) => void onRoundOpen(match, round))

  await tick(app)

  const timer = setInterval(() => void tick(app), TICK_MS)
  timer.unref?.()
}
