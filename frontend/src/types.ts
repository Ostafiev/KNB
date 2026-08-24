export type Screen =
  | 'splash'
  | 'consent'
  | 'home'
  | 'opponents'
  | 'create'
  | 'waiting'
  | 'battle'
  | 'result'
  | 'summary'

export type Choice = 'rock' | 'scissors' | 'paper' | null
export type HandChoice = NonNullable<Choice>

export type Tab = 'random' | 'friends'
export type Outcome = 'win' | 'lose' | 'draw'
export type Lang = 'ru' | 'en'
export type Theme = 'dark' | 'light'

/** Режим матча. От него зависит доступность текстового условия пари (ЧАСТЬ 2, п.11). */
export type MatchMode = 'random' | 'friend'

export interface Player {
  id: number
  name: string
  avatar: string
  rating: number
  bet: number
  rounds: number
  online: boolean
}

export interface PlayerStats {
  games: number
  wins: number
  losses: number
  draws: number
}

/** Условия матча, согласованные до старта боя. */
export interface MatchConfig {
  mode: MatchMode
  bet: number
  roundsTotal: number
  /** Текстовое условие пари. Только для mode === 'friend' (ЧАСТЬ 2, п.11). */
  condition: string
  opponentName: string
  opponentAvatar: string
  /** Рейтинг соперника — нужен для расчёта Elo (ЧАСТЬ 5). */
  opponentRating: number
}

/** Результат одного сыгранного раунда. */
export interface RoundResult {
  round: number
  playerChoice: HandChoice
  opponentChoice: HandChoice
  outcome: Outcome
}
