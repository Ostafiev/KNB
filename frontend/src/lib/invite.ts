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

/**
 * Адрес, по которому Telegram сам показывает окно «Выберите чаты».
 *
 * Ничего просить у клиента не нужно: это обычная ссылка, а такие ссылки
 * Telegram перехватывает внутри приложения. Поэтому она работает там, где
 * не работали команды через Bot API — они уходили в пустоту без ответа.
 *
 * Оба куска обязательно кодируем: в тексте вызова живут переводы строк,
 * решётки и амперсанды, и без кодирования сообщение обрывается на первом же.
 */
export function buildShareHref(inviteUrl: string, message: string): string {
  return (
    'https://t.me/share/url' +
    `?url=${encodeURIComponent(inviteUrl)}` +
    `&text=${encodeURIComponent(message)}`
  )
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
