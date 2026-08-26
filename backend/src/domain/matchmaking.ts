import { redis } from '../lib/redis.js'
import { createMatch, startMatch, MatchError, type MatchRow, type RoundRow } from './match.js'

/**
 * Подбор случайного соперника.
 *
 * Очередь живёт в Redis и разбита по «корзинам»: играть можно только с тем,
 * у кого совпали ставка и число раундов. Иначе пришлось бы придумывать, чью
 * ставку считать настоящей.
 *
 * Данные очереди намеренно одноразовые: если сервер перезапустится, очередь
 * пропадёт, и игроки просто встанут заново. Ничего ценного здесь не лежит —
 * матчи и деньги живут в PostgreSQL.
 */

const QUEUE_TTL_SECONDS = 15 * 60

function bucketKey(bet: number, rounds: number): string {
  return `knb:queue:${bet}:${rounds}`
}

function userKey(userId: number): string {
  return `knb:queue:user:${userId}`
}

export interface QueueResult {
  /** Соперник найден и матч уже начат. */
  matched: boolean
  match?: MatchRow
  round?: RoundRow
  /** Игрок поставлен в очередь и ждёт. */
  waiting?: { bet: number; rounds: number }
}

/**
 * Проверка «этот игрок всё ещё на связи». Реализацию подставляет слой
 * WebSocket: очередь не должна знать про сокеты, а сокеты — про Redis.
 */
export type LivenessCheck = (userId: number) => boolean

let isOnline: LivenessCheck = () => true

export function setLivenessCheck(check: LivenessCheck): void {
  isOnline = check
}

export async function enqueue(
  userId: number,
  bet: number,
  rounds: number,
): Promise<QueueResult> {
  if (bet <= 0) {
    throw new MatchError('free_only_friend', 'бесплатно играть можно только с другом')
  }

  // Игрок мог остаться в другой корзине после разрыва связи.
  await dequeue(userId)

  const key = bucketKey(bet, rounds)

  /*
   * Достаём соперников по одному, пока не найдём живого. Мёртвые заявки
   * остаются от тех, кто закрыл приложение, не выйдя из очереди.
   */
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = await redis.rpop(key)
    if (!candidate) break

    const opponentId = Number(candidate)
    if (!Number.isSafeInteger(opponentId) || opponentId === userId) continue

    await redis.del(userKey(opponentId))
    if (!isOnline(opponentId)) continue

    /*
     * Матч заводит соперник, который ждал дольше: он становится первым
     * игроком. Кто первым нажал «Играть», тот и player1 — так честнее
     * выглядит история матчей.
     */
    try {
      const match = await createMatch({ mode: 'random', player1Id: opponentId, bet, rounds })
      const started = await startMatch(match.id, userId)
      return { matched: true, match: started.match, round: started.round }
    } catch (error) {
      /*
       * У соперника не хватило медяков или он заблокирован — его заявка
       * просто пропадает, а мы пробуем следующего.
       */
      if (error instanceof MatchError) continue
      throw error
    }
  }

  await redis.lpush(key, String(userId))
  await redis.expire(key, QUEUE_TTL_SECONDS)
  await redis.set(userKey(userId), `${bet}:${rounds}`, 'EX', QUEUE_TTL_SECONDS)

  return { matched: false, waiting: { bet, rounds } }
}

export async function dequeue(userId: number): Promise<boolean> {
  const stored = await redis.get(userKey(userId))
  if (!stored) return false

  const [bet, rounds] = stored.split(':').map(Number)
  await redis.lrem(bucketKey(bet, rounds), 0, String(userId))
  await redis.del(userKey(userId))
  return true
}

export async function queueSize(bet: number, rounds: number): Promise<number> {
  return redis.llen(bucketKey(bet, rounds))
}
