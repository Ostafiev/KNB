import { query, queryOne } from '../db/client.js'
import { displayRound, winsNeeded, type Choice, type MatchRow, type RoundRow } from './match.js'

/**
 * Представление матча для приложения — всегда с точки зрения конкретного игрока.
 *
 * Важное правило: пока раунд не разрешён, чужая фигура не уходит в приложение
 * ни при каких условиях. Иначе достаточно было бы посмотреть сетевой ответ,
 * чтобы выбрать выигрышный вариант. Отдаём только факт «соперник уже сходил».
 */

export interface PlayerView {
  id: number
  nickname: string
  avatarId: string
  rating: number
}

export interface RoundView {
  number: number
  /** Номер раунда для игрока: ничьи не двигают счётчик. */
  display: number
  myChoice: Choice | null
  opponentChoice: Choice | null
  opponentMoved: boolean
  result: 'win' | 'loss' | 'draw' | null
  myTimedOut: boolean
  opponentTimedOut: boolean
  startedAt: string
  resolvedAt: string | null
}

export interface MatchView {
  id: number
  mode: 'random' | 'friend'
  status: string
  bet: number
  roundsTotal: number
  winsNeeded: number
  condition: string | null
  me: PlayerView
  opponent: PlayerView | null
  myScore: number
  opponentScore: number
  currentRound: number
  rounds: RoundView[]
  finished: boolean
  won: boolean | null
  ratingDelta: number
  /** Сколько медяков изменилось на счету по итогам матча. */
  coinsDelta: number
  /** Матч закончился тем, что соперник вышел. */
  opponentLeft: boolean
  /** Матч закончился тем, что вышел сам игрок. */
  iLeft: boolean
  /** Матч отменён и ставки возвращены — играть было некому. */
  cancelled: boolean
  startedAt: string | null
  finishedAt: string | null
}

async function playerView(id: number | null): Promise<PlayerView | null> {
  if (id === null) return null
  const row = await queryOne<{ id: number; nickname: string; avatar_id: string; rating: number }>(
    'SELECT id, nickname, avatar_id, rating FROM users WHERE id = $1',
    [id],
  )
  if (!row) return null
  return { id: row.id, nickname: row.nickname, avatarId: row.avatar_id, rating: row.rating }
}

export async function buildMatchView(
  match: MatchRow,
  viewerId: number,
  rounds?: RoundRow[],
): Promise<MatchView> {
  const iAmFirst = match.player1_id === viewerId
  const opponentId = iAmFirst ? match.player2_id : match.player1_id

  const [me, opponent] = await Promise.all([playerView(viewerId), playerView(opponentId)])

  const roundRows =
    rounds ??
    (await query<RoundRow>('SELECT * FROM rounds WHERE match_id = $1 ORDER BY round_number', [
      match.id,
    ]))

  const myScore = iAmFirst ? match.score1 : match.score2
  const opponentScore = iAmFirst ? match.score2 : match.score1
  const ratingDelta = iAmFirst ? match.rating1_delta : match.rating2_delta

  // Отменённый начатый матч для приложения тоже закончен: экран боя закрывается.
  const cancelled = match.status === 'cancelled' && match.started_at !== null
  const finished = match.status === 'finished' || cancelled
  const won = match.status === 'finished' ? match.winner_id === viewerId : null

  /*
   * Свободных медяков по итогам: победитель забирает обе ставки, то есть
   * выходит в плюс на размер ставки; проигравший теряет свою.
   */
  let coinsDelta = 0
  if (match.status === 'finished' && match.bet_amount > 0) {
    coinsDelta = won ? match.bet_amount : -match.bet_amount
  }

  const opponentLeft = finished && match.finish_reason === 'abandoned' && match.winner_id === viewerId
  const iLeft = finished && match.finish_reason === 'abandoned' && match.winner_id !== viewerId

  const viewRounds: RoundView[] = roundRows.map((r) => {
    const myChoice = iAmFirst ? r.player1_choice : r.player2_choice
    const theirChoice = iAmFirst ? r.player2_choice : r.player1_choice
    const theirMoveAt = iAmFirst ? r.player2_move_at : r.player1_move_at

    let result: RoundView['result'] = null
    if (r.result === 'draw') result = 'draw'
    else if (r.result !== null) result = (r.result === 'player1') === iAmFirst ? 'win' : 'loss'

    return {
      number: r.round_number,
      display: r.round_number,
      myChoice,
      // Чужая фигура открывается только вместе с результатом раунда.
      opponentChoice: r.resolved_at ? theirChoice : null,
      opponentMoved: theirMoveAt !== null,
      result,
      myTimedOut: iAmFirst ? r.player1_timed_out : r.player2_timed_out,
      opponentTimedOut: iAmFirst ? r.player2_timed_out : r.player1_timed_out,
      startedAt: r.started_at,
      resolvedAt: r.resolved_at,
    }
  })

  // Нумерация «Раунд X из N» считает только результативные раунды.
  let decisive = 0
  for (const [index, r] of roundRows.entries()) {
    viewRounds[index].display = Math.min(decisive + 1, match.rounds_total)
    if (r.result === 'player1' || r.result === 'player2') decisive += 1
  }

  return {
    id: match.id,
    mode: match.mode,
    status: match.status,
    bet: match.bet_amount,
    roundsTotal: match.rounds_total,
    winsNeeded: winsNeeded(match.rounds_total),
    condition: match.condition,
    me: me!,
    opponent,
    myScore,
    opponentScore,
    currentRound: displayRound(match),
    rounds: viewRounds,
    finished,
    won,
    ratingDelta,
    coinsDelta,
    opponentLeft,
    iLeft,
    cancelled,
    startedAt: match.started_at,
    finishedAt: match.finished_at,
  }
}
