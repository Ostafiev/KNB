import type { Player } from '../types'

/*
 * Демо-данные фронтенда.
 * TODO(backend): заменить на выдачу API — GET /api/opponents, /api/friends,
 * /api/me, /api/matches/recent (ЧАСТЬ 3).
 */

export const OPPONENTS: Player[] = [
  { id: 1, name: 'Алексей К.', avatar: '👨‍💻', rating: 1840, bet: 50, rounds: 3, online: true },
  { id: 2, name: 'Мария Т.', avatar: '👩‍🎨', rating: 2110, bet: 120, rounds: 5, online: true },
  { id: 3, name: 'Дмитрий Р.', avatar: '🧑‍🚀', rating: 990, bet: 25, rounds: 1, online: false },
  { id: 4, name: 'Анна С.', avatar: '👩‍💼', rating: 1560, bet: 200, rounds: 3, online: true },
  { id: 5, name: 'Иван П.', avatar: '🧑‍🍳', rating: 720, bet: 75, rounds: 5, online: true },
]

export const FRIENDS: Player[] = [
  { id: 6, name: 'Сергей', avatar: '🤠', rating: 1300, bet: 100, rounds: 3, online: true },
  { id: 7, name: 'Катя', avatar: '🧝‍♀️', rating: 1750, bet: 150, rounds: 5, online: false },
  { id: 8, name: 'Паша', avatar: '🧑‍🎸', rating: 880, bet: 50, rounds: 1, online: true },
]

/**
 * Набор готовых аватаров (ЧАСТЬ 3, п.7 — 10-15 вариантов).
 * Сервер хранит идентификатор, приложение показывает эмодзи: так набор
 * можно переоформить, не трогая сохранённые профили.
 */
export const AVATARS: { id: string; emoji: string }[] = [
  { id: 'gamepad', emoji: '🎮' },
  { id: 'dev', emoji: '👨‍💻' },
  { id: 'artist', emoji: '👩‍🎨' },
  { id: 'astronaut', emoji: '🧑‍🚀' },
  { id: 'manager', emoji: '👩‍💼' },
  { id: 'chef', emoji: '🧑‍🍳' },
  { id: 'cowboy', emoji: '🤠' },
  { id: 'elf', emoji: '🧝‍♀️' },
  { id: 'rocker', emoji: '🧑‍🎸' },
  { id: 'fox', emoji: '🦊' },
  { id: 'panda', emoji: '🐼' },
  { id: 'dragon', emoji: '🐉' },
  { id: 'owl', emoji: '🦉' },
  { id: 'wolf', emoji: '🐺' },
  { id: 'lion', emoji: '🦁' },
]

export function avatarEmoji(id: string): string {
  return AVATARS.find((a) => a.id === id)?.emoji ?? '🎮'
}

export interface RecentGame {
  opp: string
  result: 'win' | 'lose' | 'draw'
  delta: number
  hand: string
  /** Сколько раундов было в матче — правка 6. */
  rounds: number
  minutesAgo: number
}

export const RECENT_GAMES: RecentGame[] = [
  { opp: 'Алексей К.', result: 'win', delta: 50, hand: '✊', rounds: 3, minutesAgo: 2 },
  { opp: 'Мария Т.', result: 'lose', delta: -120, hand: '✌️', rounds: 5, minutesAgo: 18 },
  { opp: 'Незнакомец', result: 'draw', delta: 0, hand: '✋', rounds: 1, minutesAgo: 60 },
  { opp: 'Дмитрий Р.', result: 'win', delta: 25, hand: '✋', rounds: 3, minutesAgo: 180 },
  { opp: 'Анна С.', result: 'lose', delta: -200, hand: '✊', rounds: 7, minutesAgo: 1500 },
]
