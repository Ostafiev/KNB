import type { PoolClient } from 'pg'
import { queryOne, withTransaction } from '../db/client.js'
import { getEconomyConfig } from './appConfig.js'
import { postEntry, DuplicateOperation, InsufficientFunds } from './ledger.js'
import { payReferralBonusIfDue } from './referrals.js'

/**
 * Правила матча и всё, что меняет его состояние.
 *
 * Главный принцип: исход раунда и матча считает только сервер. Клиент
 * присылает единственное — какую фигуру выбрал игрок. Время хода штампует
 * сервер (ЧАСТЬ 3, п.5), счёт и выплаты тоже считает сервер, поэтому
 * подкрутить результат из приложения нельзя.
 *
 * Каждое изменение матча идёт под блокировкой строки матча (FOR UPDATE):
 * два игрока ходят одновременно, и без блокировки два запроса могли бы
 * увидеть один и тот же раунд незавершённым и разрешить его дважды.
 */

export type Choice = 'rock' | 'scissors' | 'paper'
export type RoundResult = 'player1' | 'player2' | 'draw'
export type MatchMode = 'random' | 'friend'
export type MatchStatus = 'pending' | 'searching' | 'active' | 'finished' | 'cancelled' | 'expired'

/** Кто кого бьёт. Единственный источник правды о правилах игры. */
const BEATS: Record<Choice, Choice> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
}

export const CHOICES: Choice[] = ['rock', 'scissors', 'paper']

export function isChoice(value: unknown): value is Choice {
  return typeof value === 'string' && (CHOICES as string[]).includes(value)
}

export function resolveChoices(first: Choice, second: Choice): RoundResult {
  if (first === second) return 'draw'
  return BEATS[first] === second ? 'player1' : 'player2'
}

/**
 * Сколько раундов надо выиграть. Раундов всегда нечётное число, поэтому
 * ничья по матчу невозможна: кто-то первым наберёт большинство.
 *
 * Ничейные раунды не приближают никого к победе — с точки зрения игрока
 * раунд просто переигрывается. В базе при этом остаётся честная запись:
 * ничья тоже сохраняется со своими фигурами и временем ходов.
 */
export function winsNeeded(roundsTotal: number): number {
  return (roundsTotal + 1) / 2
}

export interface MatchRow {
  id: number
  mode: MatchMode
  status: MatchStatus
  player1_id: number
  player2_id: number | null
  bet_amount: number
  rounds_total: number
  condition: string | null
  winner_id: number | null
  score1: number
  score2: number
  rating1_delta: number
  rating2_delta: number
  rematch_of: number | null
  invited_id: number | null
  expires_at: string | null
  finish_reason: 'played' | 'abandoned' | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface RoundRow {
  id: number
  match_id: number
  round_number: number
  player1_choice: Choice | null
  player2_choice: Choice | null
  started_at: string
  player1_move_at: string | null
  player2_move_at: string | null
  player1_timed_out: boolean
  player2_timed_out: boolean
  result: RoundResult | null
  resolved_at: string | null
  abandoned: boolean
}

export class MatchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MatchError'
  }
}

// ─── Чтение ──────────────────────────────────────────────────────────────────

export async function getMatch(id: number): Promise<MatchRow | null> {
  return queryOne<MatchRow>('SELECT * FROM matches WHERE id = $1', [id])
}

export async function getRounds(matchId: number): Promise<RoundRow[]> {
  const { rows } = await (
    await import('../db/client.js')
  ).pool.query<RoundRow>('SELECT * FROM rounds WHERE match_id = $1 ORDER BY round_number', [matchId])
  return rows
}

async function lockMatch(client: PoolClient, id: number): Promise<MatchRow> {
  const { rows } = await client.query<MatchRow>('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [
    id,
  ])
  if (rows.length === 0) throw new MatchError('match_not_found', 'матч не найден')
  return rows[0]
}

async function currentRound(client: PoolClient, matchId: number): Promise<RoundRow | null> {
  const { rows } = await client.query<RoundRow>(
    `SELECT * FROM rounds
      WHERE match_id = $1 AND resolved_at IS NULL
      ORDER BY round_number DESC
      LIMIT 1
      FOR UPDATE`,
    [matchId],
  )
  return rows[0] ?? null
}

/** Номер раунда с точки зрения игрока: ничьи не двигают счётчик. */
export function displayRound(match: Pick<MatchRow, 'score1' | 'score2' | 'rounds_total'>): number {
  return Math.min(match.score1 + match.score2 + 1, match.rounds_total)
}

export function slotOf(match: MatchRow, userId: number): 1 | 2 {
  if (match.player1_id === userId) return 1
  if (match.player2_id === userId) return 2
  throw new MatchError('not_a_player', 'игрок не участвует в этом матче')
}

// ─── Создание ────────────────────────────────────────────────────────────────

export interface CreateMatchInput {
  mode: MatchMode
  player1Id: number
  bet: number
  rounds: number
  condition?: string | null
  rematchOf?: number | null
  /**
   * Кого именно позвали. Персональный вызов может принять только этот игрок;
   * приглашение ссылкой (null) открыто любому, кто её получил.
   */
  invitedId?: number | null
  /** Сколько вызов ждёт ответа, в миллисекундах. Без срока вызовы копились бы. */
  expiresInMs?: number | null
}

/**
 * Заводит матч. Ставка на этом шаге ещё не списывается: пока соперник
 * не нашёлся, деньги игрока не трогаем — иначе выход из очереди пришлось бы
 * возвращать отдельной операцией.
 */
export async function createMatch(input: CreateMatchInput): Promise<MatchRow> {
  const economy = await getEconomyConfig()

  if (input.rounds % 2 !== 1 || input.rounds < 1) {
    throw new MatchError('bad_rounds', 'число раундов должно быть нечётным')
  }
  if (input.bet < 0) throw new MatchError('bad_bet', 'ставка не может быть отрицательной')
  if (input.bet === 0 && input.mode !== 'friend') {
    throw new MatchError('free_only_friend', 'бесплатно играть можно только с другом')
  }
  if (input.bet > 0 && (input.bet < economy.minBet || input.bet > economy.maxBet)) {
    throw new MatchError(
      'bet_out_of_range',
      `ставка должна быть от ${economy.minBet} до ${economy.maxBet}`,
    )
  }
  if (input.condition && input.mode !== 'friend') {
    throw new MatchError('condition_only_friend', 'условие пари доступно только с другом')
  }

  /*
   * Проверяем, что игроку хватает медяков, до того как он встал в очередь.
   * Это не резерв — окончательная проверка будет при списании, — но она
   * избавляет от бессмысленного ожидания соперника с пустым кошельком.
   */
  if (input.bet > 0) {
    const row = await queryOne<{ coins_balance: number }>(
      'SELECT coins_balance FROM users WHERE id = $1',
      [input.player1Id],
    )
    if (!row) throw new MatchError('user_not_found', 'игрок не найден')
    if (row.coins_balance < input.bet) {
      throw new MatchError('insufficient_funds', 'не хватает медяков на ставку')
    }
  }

  const status: MatchStatus = input.mode === 'random' ? 'searching' : 'pending'

  if (input.invitedId !== undefined && input.invitedId !== null) {
    if (input.mode !== 'friend') {
      throw new MatchError('invite_only_friend', 'позвать поимённо можно только в матч с другом')
    }
    if (input.invitedId === input.player1Id) {
      throw new MatchError('same_player', 'нельзя позвать самого себя')
    }
  }

  const created = await queryOne<MatchRow>(
    `INSERT INTO matches
       (mode, status, player1_id, bet_amount, rounds_total, condition, rematch_of,
        invited_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             CASE WHEN $9::bigint IS NULL THEN NULL
                  ELSE now() + ($9::bigint * INTERVAL '1 millisecond') END)
     RETURNING *`,
    [
      input.mode,
      status,
      input.player1Id,
      input.bet,
      input.rounds,
      input.condition ?? null,
      input.rematchOf ?? null,
      input.invitedId ?? null,
      input.expiresInMs ?? null,
    ],
  )
  return created!
}

// ─── Старт ───────────────────────────────────────────────────────────────────

export interface StartedMatch {
  match: MatchRow
  round: RoundRow
}

/**
 * Второй игрок входит в матч: списываем ставки с обоих и открываем первый раунд.
 *
 * Оба списания и старт раунда — одна транзакция. Если у второго игрока не
 * хватило медяков, первый ничего не теряет: транзакция откатывается целиком.
 */
export async function startMatch(matchId: number, player2Id: number): Promise<StartedMatch> {
  return withTransaction(async (client) => {
    const match = await lockMatch(client, matchId)

    if (match.status !== 'pending' && match.status !== 'searching') {
      throw new MatchError('match_not_joinable', 'к этому матчу уже нельзя присоединиться')
    }
    /*
     * Второй игрок уже записан — это нормально для приглашения другу:
     * он принял вызов раньше и вернулся, когда хозяин освободился.
     * Чужому места по-прежнему нет.
     */
    if (match.player2_id !== null && match.player2_id !== player2Id) {
      throw new MatchError('match_full', 'в матче уже есть второй игрок')
    }
    if (match.player1_id === player2Id) {
      throw new MatchError('same_player', 'нельзя играть с самим собой')
    }

    /*
     * Персональный вызов принадлежит тому, кого позвали. Иначе ссылку на матч
     * можно было бы перехватить и войти вместо друга.
     */
    if (match.invited_id !== null && match.invited_id !== player2Id) {
      throw new MatchError('not_invited', 'этот бой ждёт другого игрока')
    }
    if (match.expires_at !== null && new Date(match.expires_at).getTime() <= Date.now()) {
      throw new MatchError('challenge_expired', 'время вызова истекло')
    }

    const opponent = await client.query<{ banned_at: string | null }>(
      'SELECT banned_at FROM users WHERE id = $1',
      [player2Id],
    )
    if (opponent.rows.length === 0) throw new MatchError('user_not_found', 'игрок не найден')
    if (opponent.rows[0].banned_at) throw new MatchError('banned', 'аккаунт заблокирован')

    if (match.bet_amount > 0) {
      for (const userId of [match.player1_id, player2Id]) {
        try {
          await postEntry(client, {
            userId,
            type: 'bet_hold',
            amount: -match.bet_amount,
            matchId: match.id,
            externalId: `match:${match.id}:hold:${userId}`,
            comment: 'ставка в матче',
          })
        } catch (error) {
          if (error instanceof InsufficientFunds) {
            throw new MatchError('insufficient_funds', 'не хватает медяков на ставку')
          }
          if (error instanceof DuplicateOperation) continue
          throw error
        }
      }
    }

    const { rows } = await client.query<MatchRow>(
      `UPDATE matches
          SET player2_id = $2, status = 'active', started_at = now()
        WHERE id = $1
        RETURNING *`,
      [match.id, player2Id],
    )

    const round = await openRound(client, rows[0], 1)
    return { match: rows[0], round }
  })
}

async function openRound(
  client: PoolClient,
  match: MatchRow,
  roundNumber: number,
): Promise<RoundRow> {
  const { rows } = await client.query<RoundRow>(
    `INSERT INTO rounds (match_id, round_number, started_at)
     VALUES ($1, $2, now())
     RETURNING *`,
    [match.id, roundNumber],
  )
  return rows[0]
}

// ─── Ход ─────────────────────────────────────────────────────────────────────

export interface MoveOutcome {
  match: MatchRow
  /** Раунд, в который пришёл ход. Уже разрешённый, если ходили оба. */
  round: RoundRow
  /** Раунд разрешён этим ходом. */
  resolved: boolean
  /** Следующий раунд, если матч продолжается. Открывается не сразу — см. openNextRound. */
  nextRound: RoundRow | null
  /** Матч продолжается: следующий раунд надо открыть после паузы на показ результата. */
  continues: boolean
  /** Матч завершён этим ходом. */
  finished: boolean
  /** Подозрительно быстрый ход — меньше физически возможного времени реакции. */
  suspiciouslyFast: boolean
}

export async function recordMove(
  matchId: number,
  userId: number,
  choice: Choice,
): Promise<MoveOutcome> {
  const economy = await getEconomyConfig()

  return withTransaction(async (client) => {
    const match = await lockMatch(client, matchId)
    if (match.status !== 'active') throw new MatchError('match_not_active', 'матч не идёт')

    const slot = slotOf(match, userId)
    const round = await currentRound(client, matchId)
    if (!round) throw new MatchError('no_open_round', 'сейчас нет открытого раунда')

    const already = slot === 1 ? round.player1_choice : round.player2_choice
    if (already !== null) throw new MatchError('already_moved', 'ход в этом раунде уже сделан')

    const elapsedMs = Date.now() - new Date(round.started_at).getTime()
    const suspiciouslyFast = elapsedMs < economy.minReactionMs

    const { rows } = await client.query<RoundRow>(
      `UPDATE rounds
          SET player${slot}_choice = $2, player${slot}_move_at = now()
        WHERE id = $1
        RETURNING *`,
      [round.id, choice],
    )
    const updated = rows[0]

    if (updated.player1_choice === null || updated.player2_choice === null) {
      return {
        match,
        round: updated,
        resolved: false,
        nextRound: null,
        continues: false,
        finished: false,
        suspiciouslyFast,
      }
    }

    const result = resolveChoices(updated.player1_choice, updated.player2_choice)
    const settled = await settleRound(client, match, updated, result)

    return { ...settled, suspiciouslyFast }
  })
}

// ─── Таймаут ─────────────────────────────────────────────────────────────────

/**
 * Раунд не уложился в отведённое время.
 *
 * По решению заказчика: не успел выбрать фигуру — раунд проигран.
 * Если не успели оба, раунд считается ничьёй и переигрывается.
 */
export async function expireRound(matchId: number, roundNumber: number): Promise<MoveOutcome | null> {
  return withTransaction(async (client) => {
    const match = await lockMatch(client, matchId)
    if (match.status !== 'active') return null

    const round = await currentRound(client, matchId)
    if (!round || round.round_number !== roundNumber) return null

    const p1Missing = round.player1_choice === null
    const p2Missing = round.player2_choice === null
    if (!p1Missing && !p2Missing) return null

    const { rows } = await client.query<RoundRow>(
      `UPDATE rounds
          SET player1_timed_out = $2, player2_timed_out = $3
        WHERE id = $1
        RETURNING *`,
      [round.id, p1Missing, p2Missing],
    )
    const updated = rows[0]

    const result: RoundResult =
      p1Missing && p2Missing ? 'draw' : p1Missing ? 'player2' : 'player1'

    /*
     * Не сходил никто. Если так случилось второй раз подряд — за экранами
     * пусто, и матч надо закрыть, иначе он будет плодить раунды до скончания
     * века. Ставки возвращаем: игры не было.
     */
    if (p1Missing && p2Missing) {
      const { rows: recent } = await client.query<{ player1_timed_out: boolean; player2_timed_out: boolean }>(
        `SELECT player1_timed_out, player2_timed_out
           FROM rounds
          WHERE match_id = $1 AND resolved_at IS NOT NULL
          ORDER BY round_number DESC
          LIMIT $2`,
        [matchId, ABANDONED_BY_BOTH_LIMIT - 1],
      )
      const everyoneGone =
        recent.length >= ABANDONED_BY_BOTH_LIMIT - 1 &&
        recent.every((r) => r.player1_timed_out && r.player2_timed_out)

      if (everyoneGone || round.round_number >= roundHardLimit(match.rounds_total)) {
        await client.query(
          `UPDATE rounds SET result = 'draw', resolved_at = now() WHERE id = $1`,
          [round.id],
        )
        const cancelled = await cancelMatch(client, match, 'оба игрока не отвечают')
        return {
          match: cancelled,
          round: updated,
          resolved: true,
          nextRound: null,
          continues: false,
          finished: true,
          suspiciouslyFast: false,
        }
      }
    }

    const settled = await settleRound(client, match, updated, result)
    return { ...settled, suspiciouslyFast: false }
  })
}

// ─── Выход из матча ──────────────────────────────────────────────────────────

/**
 * Игрок вышел из матча.
 *
 * Сыгранные раунды остаются как есть — с фигурами, счётом и историей.
 * Незаконченный раунд засчитывается ушедшему как проигранный, и матч
 * заканчивается его техническим поражением.
 */
export async function abandonMatch(
  matchId: number,
  userId: number,
): Promise<{ match: MatchRow; round: RoundRow | null } | null> {
  return withTransaction(async (client) => {
    const match = await lockMatch(client, matchId)

    // Соперник ещё не пришёл — просто отменяем, ставку никто не платил.
    if (match.status === 'pending' || match.status === 'searching') {
      if (match.player1_id !== userId) {
        throw new MatchError('not_a_player', 'игрок не участвует в этом матче')
      }
      const { rows } = await client.query<MatchRow>(
        `UPDATE matches SET status = 'cancelled', finished_at = now() WHERE id = $1 RETURNING *`,
        [match.id],
      )
      return { match: rows[0], round: null }
    }

    if (match.status !== 'active') return null

    const slot = slotOf(match, userId)
    const round = await currentRound(client, matchId)

    let closedRound: RoundRow | null = null
    if (round) {
      const result: RoundResult = slot === 1 ? 'player2' : 'player1'
      const { rows } = await client.query<RoundRow>(
        `UPDATE rounds
            SET player${slot}_timed_out = TRUE, abandoned = TRUE, result = $2, resolved_at = now()
          WHERE id = $1
          RETURNING *`,
        [round.id, result],
      )
      closedRound = rows[0]

      const column = result === 'player1' ? 'score1' : 'score2'
      await client.query(`UPDATE matches SET ${column} = ${column} + 1 WHERE id = $1`, [match.id])
    }

    const fresh = await lockMatch(client, matchId)
    const winnerId = slot === 1 ? fresh.player2_id! : fresh.player1_id
    const finished = await finishMatch(client, fresh, winnerId, 'abandoned')

    return { match: finished, round: closedRound }
  })
}

// ─── Разрешение раунда и завершение матча ────────────────────────────────────

async function settleRound(
  client: PoolClient,
  match: MatchRow,
  round: RoundRow,
  result: RoundResult,
): Promise<Omit<MoveOutcome, 'suspiciouslyFast'>> {
  const { rows: roundRows } = await client.query<RoundRow>(
    `UPDATE rounds SET result = $2, resolved_at = now() WHERE id = $1 RETURNING *`,
    [round.id, result],
  )
  const resolvedRound = roundRows[0]

  let score1 = match.score1
  let score2 = match.score2
  if (result === 'player1') score1 += 1
  if (result === 'player2') score2 += 1

  const { rows: matchRows } = await client.query<MatchRow>(
    `UPDATE matches SET score1 = $2, score2 = $3 WHERE id = $1 RETURNING *`,
    [match.id, score1, score2],
  )
  let current = matchRows[0]

  const need = winsNeeded(current.rounds_total)
  if (score1 >= need || score2 >= need) {
    const winnerId = score1 >= need ? current.player1_id : current.player2_id!
    current = await finishMatch(client, current, winnerId, 'played')
    return {
      match: current,
      round: resolvedRound,
      resolved: true,
      nextRound: null,
      continues: false,
      finished: true,
    }
  }

  /*
   * Следующий раунд здесь не открываем. Игроки сейчас смотрят на результат
   * прошлого, и если запустить часы немедленно, эта пауза съест их время
   * на ход. Раунд откроет openNextRound после паузы на показ результата.
   */
  return {
    match: current,
    round: resolvedRound,
    resolved: true,
    nextRound: null,
    continues: true,
    finished: false,
  }
}

/**
 * Открывает следующий раунд. Вызывается после паузы на показ результата
 * предыдущего — часы раунда должны начать идти тогда, когда игрок уже
 * смотрит на арену, а не на итог прошлого раунда.
 */
export async function openNextRound(
  matchId: number,
): Promise<{ match: MatchRow; round: RoundRow } | null> {
  return withTransaction(async (client) => {
    const match = await lockMatch(client, matchId)
    if (match.status !== 'active') return null

    const open = await currentRound(client, matchId)
    if (open) return { match, round: open }

    const { rows } = await client.query<{ max: number | null }>(
      'SELECT MAX(round_number) AS max FROM rounds WHERE match_id = $1',
      [matchId],
    )
    const nextNumber = (rows[0]?.max ?? 0) + 1
    const round = await openRound(client, match, nextNumber)
    return { match, round }
  })
}

/**
 * Отменяет матч и возвращает ставки.
 *
 * Нужно там, где играть уже некому: оба игрока пропали, и раунд за раундом
 * закрывается по таймеру ничьёй. Без этого матч крутился бы вечно, плодя
 * пустые раунды. Никто не играл — никто и не должен потерять медяки.
 */
async function cancelMatch(
  client: PoolClient,
  match: MatchRow,
  reason: string,
): Promise<MatchRow> {
  if (match.bet_amount > 0) {
    for (const userId of [match.player1_id, match.player2_id!]) {
      try {
        await postEntry(client, {
          userId,
          type: 'bet_refund',
          amount: match.bet_amount,
          matchId: match.id,
          externalId: `match:${match.id}:refund:${userId}`,
          comment: 'возврат ставки: матч отменён',
        })
      } catch (error) {
        if (!(error instanceof DuplicateOperation)) throw error
      }
    }
  }

  const { rows } = await client.query<MatchRow>(
    `UPDATE matches
        SET status = 'cancelled', finished_at = now(), finish_reason = NULL
      WHERE id = $1
      RETURNING *`,
    [match.id],
  )

  await client.query(
    `INSERT INTO events (user_id, name, props) VALUES ($1, 'match_cancelled', $2)`,
    [match.player1_id, JSON.stringify({ matchId: match.id, reason })],
  )

  return rows[0]
}

/**
 * Сколько раундов подряд закончились ничьёй, потому что не сходил никто.
 * Два таких подряд означают, что за экранами никого нет.
 */
const ABANDONED_BY_BOTH_LIMIT = 2

/**
 * Страховка от бесконечного матча: ничьи не двигают счёт, поэтому теоретически
 * играть можно вечно. Живым людям этого предела не достичь.
 */
function roundHardLimit(roundsTotal: number): number {
  return roundsTotal * 5 + 10
}

/** Elo. K и стартовый рейтинг берутся из app_config, их правит админка. */
function eloDelta(rating: number, opponentRating: number, score: 0 | 1, k: number): number {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400))
  return Math.round(k * (score - expected))
}

async function finishMatch(
  client: PoolClient,
  match: MatchRow,
  winnerId: number,
  reason: 'played' | 'abandoned',
): Promise<MatchRow> {
  const economy = await getEconomyConfig()
  const loserId = winnerId === match.player1_id ? match.player2_id! : match.player1_id

  /*
   * Бесплатный матч не трогает ни баланс, ни рейтинг, ни счётчик игр.
   * Иначе порогом вывода (15 сыгранных игр) можно было бы управлять
   * бесплатными матчами с другом.
   */
  const isFree = match.bet_amount === 0

  let rating1Delta = 0
  let rating2Delta = 0

  if (!isFree) {
    const { rows: players } = await client.query<{ id: number; rating: number }>(
      'SELECT id, rating FROM users WHERE id = ANY($1::bigint[]) FOR UPDATE',
      [[match.player1_id, match.player2_id!]],
    )
    const ratingOf = new Map(players.map((p) => [p.id, p.rating]))
    const winnerRating = ratingOf.get(winnerId) ?? economy.eloStart
    const loserRating = ratingOf.get(loserId) ?? economy.eloStart

    const winnerDelta = eloDelta(winnerRating, loserRating, 1, economy.eloK)
    const loserDelta = eloDelta(loserRating, winnerRating, 0, economy.eloK)

    rating1Delta = winnerId === match.player1_id ? winnerDelta : loserDelta
    rating2Delta = winnerId === match.player2_id ? winnerDelta : loserDelta

    await client.query(
      `UPDATE users
          SET rating = GREATEST(0, rating + $2),
              games_played = games_played + 1,
              wins = wins + 1,
              updated_at = now()
        WHERE id = $1`,
      [winnerId, winnerDelta],
    )
    await client.query(
      `UPDATE users
          SET rating = GREATEST(0, rating + $2),
              games_played = games_played + 1,
              losses = losses + 1,
              updated_at = now()
        WHERE id = $1`,
      [loserId, loserDelta],
    )

    // Победитель забирает обе ставки: свою назад плюс ставку соперника.
    try {
      await postEntry(client, {
        userId: winnerId,
        type: 'match_win',
        amount: match.bet_amount * 2,
        matchId: match.id,
        externalId: `match:${match.id}:win:${winnerId}`,
        comment: reason === 'abandoned' ? 'победа: соперник вышел' : 'победа в матче',
      })
    } catch (error) {
      if (!(error instanceof DuplicateOperation)) throw error
    }
  }

  const { rows } = await client.query<MatchRow>(
    `UPDATE matches
        SET status = 'finished',
            winner_id = $2,
            rating1_delta = $3,
            rating2_delta = $4,
            finish_reason = $5,
            finished_at = now()
      WHERE id = $1
      RETURNING *`,
    [match.id, winnerId, rating1Delta, rating2Delta, reason],
  )

  if (!isFree) {
    // Реферальный бонус пригласившему платится после первого матча новичка.
    await payReferralBonusIfDue(client, match.player1_id)
    await payReferralBonusIfDue(client, match.player2_id!)
  }

  return rows[0]
}
