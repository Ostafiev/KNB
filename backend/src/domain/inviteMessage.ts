import { config } from '../config.js'
import type { MatchRow } from './match.js'

/**
 * Текст приглашения другу.
 *
 * Живёт на сервере, потому что отсюда же уходит в Telegram: сообщение
 * готовит бот, а не приложение. Условия берутся из самого матча — так
 * в сообщение попадает ровно то, на что игрок согласился, а не то,
 * что прислал клиент.
 */

export type InviteLanguage = 'ru' | 'en'

const TEXT = {
  ru: {
    title: 'Вызов на бой',
    description: 'Камень-ножницы-бумага со ставкой',
    heading: 'Бросаю тебе вызов в «Камень-ножницы-бумага»!',
    condition: (value: string) => `Условие: ${value}`,
    terms: (stake: string, rounds: number) => `Ставка: ${stake} · раундов: ${rounds}`,
    free: 'бесплатно',
    coins: (amount: number) => `${amount} медяков`,
    button: '⚔️ Принять вызов',
  },
  en: {
    title: 'A challenge',
    description: 'Rock paper scissors with a stake',
    heading: 'I challenge you to Rock Paper Scissors!',
    condition: (value: string) => `Wager: ${value}`,
    terms: (stake: string, rounds: number) => `Stake: ${stake} · rounds: ${rounds}`,
    free: 'free',
    coins: (amount: number) => `${amount} coins`,
    button: '⚔️ Accept the challenge',
  },
}

export interface InviteMessage {
  title: string
  description: string
  text: string
  buttonText: string
  buttonUrl: string
}

export function buildInviteMessage(match: MatchRow, language: InviteLanguage): InviteMessage {
  const words = TEXT[language] ?? TEXT.ru
  const bet = Number(match.bet_amount)

  const lines: string[] = [words.heading]
  const condition = match.condition?.trim()
  if (condition) lines.push(words.condition(condition))
  lines.push(words.terms(bet === 0 ? words.free : words.coins(bet), match.rounds_total))

  return {
    title: words.title,
    description: condition || words.description,
    text: lines.join('\n'),
    buttonText: words.button,
    buttonUrl: `https://t.me/${config.botUsername}?startapp=match_${match.id}`,
  }
}
