import type { HandChoice, Outcome } from '../types'
import type { TranslationKey } from '../i18n'

/**
 * Канонический порядок фигур — камень, ножницы, бумага (ЧАСТЬ 2, п.1).
 * Все места, где фигуры показываются списком, обязаны брать порядок отсюда,
 * а не объявлять свой массив.
 */
export const CHOICES: readonly HandChoice[] = ['rock', 'scissors', 'paper'] as const

export const HAND_EMOJI: Record<HandChoice, string> = {
  rock: '✊',
  scissors: '✌️',
  paper: '✋',
}

export const CHOICE_LABEL_KEY: Record<HandChoice, TranslationKey> = {
  rock: 'choice.rock',
  scissors: 'choice.scissors',
  paper: 'choice.paper',
}

/** Что бьёт что. */
export const BEATS: Record<HandChoice, HandChoice> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
}

export function randomChoice(): HandChoice {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)]
}

/** Итог раунда с точки зрения игрока. */
export function resolveRound(player: HandChoice, opponent: HandChoice): Outcome {
  if (player === opponent) return 'draw'
  return BEATS[player] === opponent ? 'win' : 'lose'
}

/** Прогресс ранга по рейтингу — только для витрины на главном экране. */
const RANKS: { key: TranslationKey; from: number }[] = [
  { key: 'rank.novice', from: 0 },
  { key: 'rank.fighter', from: 1200 },
  { key: 'rank.master', from: 1700 },
  { key: 'rank.legend', from: 2200 },
]

export function rankFor(rating: number): { key: TranslationKey; progress: number; toNext: number } {
  let index = 0
  for (let i = 0; i < RANKS.length; i++) {
    if (rating >= RANKS[i].from) index = i
  }
  const current = RANKS[index]
  const next = RANKS[index + 1]
  if (!next) return { key: current.key, progress: 1, toNext: 0 }
  const span = next.from - current.from
  return {
    key: current.key,
    progress: Math.min(1, (rating - current.from) / span),
    toNext: next.from - rating,
  }
}
