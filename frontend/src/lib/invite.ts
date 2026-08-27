import { getBotUsername } from '../config/env'
import { ECONOMY } from '../config/economy'
import type { Translate } from '../i18n'

/**
 * Приглашение другу: ссылка и текст сообщения.
 *
 * Это главный способ, которым игра расходится между людьми: человек пишет
 * условие пари, выбирает друга в списке Telegram и отправляет ему готовое
 * сообщение. Поэтому текст собирается здесь, в одном месте, и выглядит
 * одинаково откуда бы его ни отправили.
 *
 * Ссылка обязательно вида `?startapp=` — она открывает саму игру. Ссылка
 * с `?start=` открыла бы переписку с ботом, где никто игрока не встретит:
 * бот не отвечает на сообщения, он только показывает приложение.
 */

export function buildInviteUrl(startParam: string): string {
  return `https://t.me/${getBotUsername()}?startapp=${encodeURIComponent(startParam)}`
}

export interface InviteTerms {
  bet: number
  rounds: number
  condition?: string | null
}

/**
 * Текст вызова. Первой строкой — сам вызов, дальше условия.
 *
 * Условие пари ставим сразу за вызовом: ради него человек и пишет другу,
 * а ставка и раунды — подробности.
 */
export function buildInviteMessage(t: Translate, terms: InviteTerms): string {
  const lines = [t('invite.message.title')]

  const condition = terms.condition?.trim()
  if (condition) lines.push(t('invite.message.condition', { condition }))

  lines.push(
    t('invite.message.terms', {
      stake: terms.bet === ECONOMY.FREE_BET ? t('bet.free') : `${terms.bet} 🪙`,
      rounds: terms.rounds,
    }),
  )

  return lines.join('\n')
}
