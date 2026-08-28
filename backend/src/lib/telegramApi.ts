import { config } from '../config.js'

/**
 * Обращения к Bot API.
 *
 * Нужны ровно для одного: подготовить сообщение, которое игрок отправит другу
 * из окна выбора чата. Всё остальное приложение делает само, без бота.
 */

export class TelegramApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

const TIMEOUT_MS = 8000

async function call<T>(method: string, payload: unknown): Promise<T> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new TelegramApiError('not_configured', 'на сервере не задан токен бота')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    )

    const body = (await response.json()) as {
      ok: boolean
      result?: T
      description?: string
      error_code?: number
    }

    if (!body.ok) {
      throw new TelegramApiError(
        `telegram_${body.error_code ?? 'error'}`,
        body.description ?? 'Telegram отказал',
      )
    }
    return body.result as T
  } catch (error) {
    if (error instanceof TelegramApiError) throw error
    throw new TelegramApiError('telegram_unreachable', 'не удалось связаться с Telegram')
  } finally {
    clearTimeout(timer)
  }
}

export interface PreparedInlineMessage {
  id: string
  expiration_date: number
}

/**
 * Готовит сообщение, которое игрок сможет отправить другу.
 *
 * Само сообщение никуда не уходит: Telegram придерживает его и отдаёт
 * приложению короткий идентификатор. Дальше приложение вызывает shareMessage,
 * Telegram показывает список чатов, и человек сам выбирает получателя.
 * Отправить кому-то без его участия невозможно.
 */
export async function savePreparedInlineMessage(input: {
  telegramUserId: number
  title: string
  description: string
  text: string
  buttonText: string
  buttonUrl: string
}): Promise<PreparedInlineMessage> {
  return call<PreparedInlineMessage>('savePreparedInlineMessage', {
    user_id: input.telegramUserId,
    allow_user_chats: true,
    allow_group_chats: true,
    allow_bot_chats: false,
    allow_channel_chats: false,
    result: {
      type: 'article',
      id: `invite_${Date.now().toString(36)}`,
      title: input.title,
      description: input.description,
      input_message_content: {
        message_text: input.text,
        // Ссылку показываем как есть: превью бота под сообщением лишнее.
        link_preview_options: { is_disabled: true },
      },
      reply_markup: {
        inline_keyboard: [[{ text: input.buttonText, url: input.buttonUrl }]],
      },
    },
  })
}
