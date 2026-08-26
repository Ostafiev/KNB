import { randomInt, randomBytes } from 'node:crypto'
import { query, queryOne, withTransaction } from '../db/client.js'
import { postEntry, DuplicateOperation } from './ledger.js'
import { CHOICES, createMatch, type Choice } from './match.js'

/**
 * Боты.
 *
 * Главное правило: бот выбирает фигуру в момент открытия раунда — до того,
 * как походил соперник, — и уже не меняет её. Сервер видит обе руки, поэтому
 * без этого правила бот мог бы «подглядывать» и выигрывать всегда. Здесь такой
 * возможности нет физически: к моменту выбора чужого хода ещё не существует.
 *
 * Выбор равномерно случайный. Это не лень: против равномерно случайного
 * соперника выиграть чаще половины невозможно ни человеку, ни программе.
 * Значит бот не выкачивает медяки из игры и не печатает их, а игрок не может
 * его обыграть скриптом. Бота, который читает привычки человека, здесь нет
 * намеренно — он обыгрывал бы живых людей в две трети раундов.
 *
 * Человекоподобие — в поведении, а не в стратегии: задержка хода, обычный
 * профиль, история матчей. Ход бот не пропускает никогда.
 */

export interface BotSettings {
  enabled: boolean
  openMatches: number
  minBet: number
  maxBet: number
  moveMinMs: number
  moveMaxMs: number
}

const DEFAULTS: BotSettings = {
  enabled: true,
  openMatches: 3,
  minBet: 25,
  maxBet: 100,
  moveMinMs: 1500,
  moveMaxMs: 7000,
}

export async function getBotSettings(): Promise<BotSettings> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value::text AS value FROM app_config WHERE key LIKE 'bots\\_%'`,
  )
  const byKey = new Map(rows.map((row) => [row.key, Number(row.value)]))

  return {
    enabled: (byKey.get('bots_enabled') ?? 1) === 1,
    openMatches: byKey.get('bots_open_matches') ?? DEFAULTS.openMatches,
    minBet: byKey.get('bots_min_bet') ?? DEFAULTS.minBet,
    maxBet: byKey.get('bots_max_bet') ?? DEFAULTS.maxBet,
    moveMinMs: byKey.get('bots_move_min_ms') ?? DEFAULTS.moveMinMs,
    moveMaxMs: byKey.get('bots_move_max_ms') ?? DEFAULTS.moveMaxMs,
  }
}

// ─── Профили ─────────────────────────────────────────────────────────────────

/**
 * Имена без выдумки: обычные, какими подписываются в Telegram. Бот с именем
 * «Терминатор 3000» выдал бы себя первым же взглядом на список.
 */
const FIRST_NAMES = [
  'Артём', 'Никита', 'Дмитрий', 'Сергей', 'Максим', 'Илья', 'Егор', 'Роман',
  'Павел', 'Кирилл', 'Данил', 'Влад', 'Антон', 'Тимур', 'Марк',
  'Анна', 'Мария', 'Ольга', 'Дарья', 'Полина', 'Юлия', 'Ксения', 'Алина',
  'Вера', 'Лиза', 'Настя', 'Катя', 'Софья', 'Милана', 'Ева',
]

const LAST_INITIALS = ['А.', 'Б.', 'В.', 'Г.', 'Д.', 'К.', 'Л.', 'М.', 'Н.', 'П.', 'Р.', 'С.', 'Т.', 'Ф.', 'Ш.']

const AVATAR_IDS = [
  'gamepad', 'dev', 'artist', 'astronaut', 'manager', 'chef', 'cowboy',
  'elf', 'rocker', 'fox', 'panda', 'dragon', 'owl', 'wolf', 'lion',
]

/** Сколько медяков держим у бота, чтобы ему всегда хватало на ставку. */
const BOT_FLOAT = 5000
const BOT_FLOAT_LOW = 1000

function pick<T>(list: T[]): T {
  return list[randomInt(list.length)]
}

export interface BotRow {
  id: number
  nickname: string
  coins_balance: number
  rating: number
}

/**
 * Заводит недостающих ботов. Telegram id берём из заведомо невозможного
 * диапазона: настоящие идентификаторы туда не попадут, и живого человека
 * с ботом не перепутать.
 */
export async function ensureBots(count: number): Promise<BotRow[]> {
  const existing = await query<BotRow>(
    'SELECT id, nickname, coins_balance, rating FROM users WHERE is_bot = TRUE ORDER BY id',
  )
  if (existing.length >= count) {
    remember(existing)
    return existing.slice(0, count)
  }

  for (let index = existing.length; index < count; index += 1) {
    const telegramId = -1_000_000 - index
    const nickname = `${pick(FIRST_NAMES)} ${pick(LAST_INITIALS)}`

    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO users
           (telegram_id, nickname, avatar_id, language, rating, referral_code, is_bot)
         VALUES ($1, $2, $3, 'ru', $4, $5, TRUE)
         ON CONFLICT (telegram_id) DO NOTHING
         RETURNING id`,
        [
          telegramId,
          nickname,
          pick(AVATAR_IDS),
          // Рейтинг около стартового: соперник не должен выглядеть ни
          // мастером, ни жертвой.
          900 + randomInt(250),
          randomBytes(5).toString('hex'),
        ],
      )
      if (rows[0]) await topUp(client, rows[0].id, BOT_FLOAT)
    })
  }

  const all = await query<BotRow>(
    'SELECT id, nickname, coins_balance, rating FROM users WHERE is_bot = TRUE ORDER BY id',
  )
  // Новые боты должны стать «своими» немедленно, ещё до того, как кто-то
  // успеет войти в их бой.
  remember(all)
  return all
}

type Client = Parameters<Parameters<typeof withTransaction>[0]>[0]

async function topUp(client: Client, botId: number, amount: number): Promise<void> {
  try {
    await postEntry(client, {
      userId: botId,
      type: 'admin_adjustment',
      amount,
      externalId: `bot_float:${botId}:${Date.now()}`,
      comment: 'пополнение бота',
    })
  } catch (error) {
    if (!(error instanceof DuplicateOperation)) throw error
  }
}

/** Не даём боту остаться без медяков посреди вечера. */
export async function refillBots(): Promise<void> {
  const poor = await query<{ id: number }>(
    'SELECT id FROM users WHERE is_bot = TRUE AND coins_balance < $1',
    [BOT_FLOAT_LOW],
  )
  for (const bot of poor) {
    await withTransaction((client) => topUp(client, bot.id, BOT_FLOAT))
  }
}

// ─── Открытые бои ────────────────────────────────────────────────────────────

/** Нечётное число раундов, как и у людей. */
const ROUNDS = [1, 3, 5]

/** Ставки кратны 25 — те же значения, что предлагает приложение. */
function randomBet(min: number, max: number): number {
  const steps = Math.max(1, Math.floor((max - min) / 25) + 1)
  return min + randomInt(steps) * 25
}

/**
 * Держит в списке нужное количество открытых боёв от ботов.
 * Возвращает, сколько создал.
 */
export async function topUpOpenMatches(settings: BotSettings): Promise<number> {
  if (!settings.enabled) return 0

  const open = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM matches m
       JOIN users u ON u.id = m.player1_id
      WHERE m.status = 'searching' AND m.player2_id IS NULL AND u.is_bot = TRUE`,
  )
  const missing = settings.openMatches - Number(open?.count ?? 0)
  if (missing <= 0) return 0

  const bots = await ensureBots(Math.max(settings.openMatches * 2, 6))
  await refillBots()

  // Боты, которые сейчас никого не ждут и ни с кем не играют.
  const busy = await query<{ id: number }>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id)
      WHERE u.is_bot = TRUE AND m.status IN ('searching', 'active')`,
  )
  const busyIds = new Set(busy.map((row) => row.id))
  const free = bots.filter((bot) => !busyIds.has(bot.id))

  let created = 0
  for (let index = 0; index < missing && index < free.length; index += 1) {
    const bet = randomBet(settings.minBet, settings.maxBet)
    try {
      await createMatch({
        mode: 'random',
        player1Id: free[index].id,
        bet,
        rounds: pick(ROUNDS),
      })
      created += 1
    } catch {
      /* боту не хватило медяков или ставка вне диапазона — пропускаем */
    }
  }

  return created
}

/** Убирает засидевшиеся заявки ботов, чтобы список не выглядел застывшим. */
export async function refreshStaleMatches(maxAgeMinutes = 20): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE matches m
        SET status = 'cancelled', finished_at = now()
       FROM users u
      WHERE u.id = m.player1_id
        AND u.is_bot = TRUE
        AND m.status = 'searching'
        AND m.player2_id IS NULL
        AND m.created_at < now() - ($1::int * INTERVAL '1 minute')
      RETURNING m.id`,
    [maxAgeMinutes],
  )
  return rows.length
}

// ─── Ход ─────────────────────────────────────────────────────────────────────

/**
 * Выбор бота. Равномерно случайный и, что важнее, сделанный до того, как
 * соперник показал руку.
 */
export function chooseFigure(): Choice {
  return CHOICES[randomInt(CHOICES.length)]
}

/** Сколько бот «думает». Никогда не дольше раунда: ход не пропускается. */
export function thinkingDelayMs(settings: BotSettings, roundSeconds: number): number {
  const ceiling = Math.max(500, roundSeconds * 1000 - 1500)
  const min = Math.min(settings.moveMinMs, ceiling)
  const max = Math.min(settings.moveMaxMs, ceiling)
  if (max <= min) return min
  return min + randomInt(max - min)
}

export async function isBot(userId: number): Promise<boolean> {
  const row = await queryOne<{ is_bot: boolean }>('SELECT is_bot FROM users WHERE id = $1', [userId])
  return row?.is_bot === true
}

// ─── Кто из игроков бот ──────────────────────────────────────────────────────

/**
 * Список известных ботов держим в памяти: спрашивать базу приходится в местах,
 * где ответ нужен сразу, — например, показывать ли открытый бой в списке.
 *
 * Обновляется он не только по расписанию, но и в тот же момент, когда бот
 * заведён. Иначе получается дыра: бот создан, бой опубликован, а сервер ещё
 * считает его посторонним — и не ходит за него.
 */
let known = new Set<number>()

function remember(rows: { id: number }[]): void {
  for (const row of rows) known.add(row.id)
}

export function isKnownBot(userId: number): boolean {
  return known.has(userId)
}

export async function refreshBotIds(): Promise<Set<number>> {
  const rows = await query<{ id: number }>('SELECT id FROM users WHERE is_bot = TRUE')
  known = new Set(rows.map((row) => row.id))
  return known
}

/** Прежнее имя: полный список ботов с обновлением памяти. */
export async function botIds(): Promise<Set<number>> {
  return refreshBotIds()
}
