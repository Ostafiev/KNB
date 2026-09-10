import { randomInt, randomBytes } from 'node:crypto'
import { query, queryOne, withTransaction } from '../db/client.js'
import { postEntry, DuplicateOperation } from './ledger.js'
import { CHOICES, createMatch, startMatch, MatchError, type Choice } from './match.js'
import { uniqueNickname } from './nicknames.js'
import { isOnline } from './presence.js'

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
  /*
   * Сколько открытых боёв держим в списке.
   *
   * Восьми хватало, чтобы найти бой, но список из восьми строк читается как
   * пустая площадка: видно, что играть почти некому. Тридцати с лишним хватает,
   * чтобы экран выглядел живым и чтобы в нём нашлись все сочетания «ставка ×
   * раунды», какие человек может выбрать, — причём не по одному разу.
   *
   * Открытый бой ничего не стоит: ставка не удерживается, пока никто не вошёл.
   */
  enabled: true,
  openMatches: 36,
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

/** Перемешивание Фишера — Йетса. Нужно, чтобы список не был всегда одним и тем же. */
function shuffle<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
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
/**
 * Переименовывает ботов, заведённых по старому образцу.
 *
 * Прежде боты подписывались «Максим Б.» — паспортным именем с инициалом. На
 * фоне живых игроков, которые зовут себя `nik99`, это бросалось в глаза, и
 * список читался как перепись. Новые боты уже другие, но старые остались бы
 * в базе навсегда — а достаточно нескольких, чтобы весь приём был раскрыт.
 */
async function renameLegacyBots(): Promise<void> {
  const legacy = await query<{ id: number }>(
    `SELECT id FROM users WHERE is_bot = TRUE AND (nickname LIKE '% %' OR nickname LIKE '%.%')`,
  )

  for (const bot of legacy) {
    const nickname = await uniqueNickname(async (candidate) => {
      const row = await queryOne<{ id: number }>(
        'SELECT id FROM users WHERE lower(nickname) = lower($1) LIMIT 1',
        [candidate],
      )
      return row !== null
    })
    await query('UPDATE users SET nickname = $2 WHERE id = $1', [bot.id, nickname])
  }
}

export async function ensureBots(count: number): Promise<BotRow[]> {
  await renameLegacyBots()

  const existing = await query<BotRow>(
    'SELECT id, nickname, coins_balance, rating FROM users WHERE is_bot = TRUE ORDER BY id',
  )
  if (existing.length >= count) {
    remember(existing)
    return existing.slice(0, count)
  }

  for (let index = existing.length; index < count; index += 1) {
    const telegramId = -1_000_000 - index
    const nickname = await uniqueNickname(async (candidate) => {
      const row = await queryOne<{ id: number }>(
        'SELECT id FROM users WHERE lower(nickname) = lower($1) LIMIT 1',
        [candidate],
      )
      return row !== null
    })

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
const ROUNDS = [3, 5, 1, 7, 9]

/**
 * Ставки, которые предлагает само приложение.
 *
 * Список должен совпадать с кнопками на экране создания боя: если бот
 * открывает бой на 175 медяков, такого выбора у человека всё равно нет,
 * и совпасть они не смогут.
 */
const BET_PRESETS = [25, 50, 100, 250, 500]

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
  /*
   * Порядок перемешиваем.
   *
   * Без этого свободные боты разбираются по возрастанию идентификатора, и
   * список всегда открывают одни и те же несколько имён. Человек, заглянувший
   * дважды за вечер, видел бы тот же состав — верный признак декорации.
   */
  const free = shuffle(bots.filter((bot) => !busyIds.has(bot.id)))

  /*
   * Открываем не что попало, а то, чего в списке не хватает.
   *
   * Раньше бот брал случайную ставку и случайное число раундов. При трёх
   * открытых боях список почти никогда не совпадал с тем, что выбрал
   * человек, — и «Найти бой» превращалось в ожидание. Теперь сначала
   * закрываем пустые сочетания из тех, что предлагает само приложение,
   * и только потом добираем повторами тех же сочетаний.
   */
  const existing = await query<{ bet_amount: string; rounds_total: number }>(
    `SELECT m.bet_amount::text, m.rounds_total
       FROM matches m
       JOIN users u ON u.id = m.player1_id
      WHERE m.status = 'searching' AND m.player2_id IS NULL AND u.is_bot = TRUE`,
  )
  const covered = new Set(existing.map((r) => `${Number(r.bet_amount)}:${r.rounds_total}`))

  /** Все сочетания, которые человек вообще может выбрать в приложении. */
  const grid: { bet: number; rounds: number }[] = []
  for (const rounds of ROUNDS) {
    for (const bet of BET_PRESETS) {
      if (bet < settings.minBet || bet > settings.maxBet) continue
      grid.push({ bet, rounds })
    }
  }
  const wanted = grid.filter((combo) => !covered.has(`${combo.bet}:${combo.rounds}`))

  let created = 0
  for (let index = 0; index < missing && index < free.length; index += 1) {
    /*
     * Сначала непокрытые сочетания, потом — по второму кругу те же.
     *
     * Повтор здесь не изъян, а правда жизни: на популярной ставке ждут
     * соперника сразу несколько человек. Случайную ставку в добор больше не
     * берём — бой на 175 медяков не совпадёт ни с чьим выбором, потому что
     * такой кнопки в приложении нет.
     */
    const combo =
      wanted[index] ??
      grid[(index - wanted.length) % Math.max(1, grid.length)] ?? {
        bet: randomBet(settings.minBet, settings.maxBet),
        rounds: pick(ROUNDS),
      }
    try {
      await createMatch({
        mode: 'random',
        player1Id: free[index].id,
        bet: combo.bet,
        rounds: combo.rounds,
      })
      created += 1
    } catch {
      /* боту не хватило медяков или ставка вне диапазона — пропускаем */
    }
  }

  return created
}

/**
 * Сколько человек ждёт соперника, прежде чем к нему зайдёт бот.
 *
 * Раньше ждать можно было бесконечно: боты держали три открытых боя со
 * случайными ставками, и совпасть с выбором человека они могли только по
 * везению. Ждать десять секунд скучно; ждать минуту — значит закрыть игру.
 */
const BOT_RESCUE_MS = 4000

/**
 * Заходит в бои, где человек ждёт слишком долго.
 *
 * Это не подмена подбора, а его нижняя граница: живой соперник всегда имеет
 * фору в семь секунд, и только если его нет — приходит бот. Условия боя не
 * трогаем, играем по тем, что выставил человек.
 */
export async function rescueWaitingPlayers(settings: BotSettings): Promise<number> {
  if (!settings.enabled) return 0

  const waiting = await query<{ id: number; player1_id: number; bet_amount: number }>(
    `SELECT m.id, m.player1_id, m.bet_amount
       FROM matches m
       JOIN users u ON u.id = m.player1_id
      WHERE m.status = 'searching'
        AND m.player2_id IS NULL
        AND u.is_bot = FALSE
        AND m.created_at < now() - ($1::int * INTERVAL '1 millisecond')
      ORDER BY m.created_at`,
    [BOT_RESCUE_MS],
  )
  if (waiting.length === 0) return 0

  const bots = await ensureBots(Math.max(settings.openMatches * 3, 12))
  await refillBots()

  const busy = await query<{ id: number }>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id)
      WHERE u.is_bot = TRUE AND m.status IN ('searching', 'active')`,
  )
  const busyIds = new Set(busy.map((row) => row.id))

  let joined = 0
  for (const match of waiting) {
    /*
     * Заходить к тому, кого нет у экрана, — ловушка.
     *
     * Бой начнётся, раунды пойдут по часам сервера, человек не сходит ни
     * разу и вернётся к готовому проигрышу, которого не видел. Раньше это
     * было редкостью: совпасть с ботом можно было только по везению.
     * Теперь бот заходит сам за семь секунд — и без этой проверки каждый,
     * кто отвлёкся сразу после нажатия, получал бы поражение ни за что.
     */
    if (!isOnline(match.player1_id)) continue

    // Бот должен потянуть ставку: проигрыш списывается с него по-настоящему.
    const free = bots.find(
      (bot) => !busyIds.has(bot.id) && Number(bot.coins_balance) >= Number(match.bet_amount),
    )
    if (!free) break

    try {
      const started = await startMatch(match.id, free.id)
      busyIds.add(free.id)
      joined += 1
      onMatchStarted?.(started)
    } catch (error) {
      // Живой соперник успел войти первым — так и должно быть.
      if (!(error instanceof MatchError)) throw error
    }
  }

  return joined
}

/**
 * Кому сообщить о начатом бое.
 *
 * Сам домен ничего не знает про сокеты: обработчик подставляет слой связи,
 * иначе бот заходил бы в матч молча и человек ждал бы дальше уже зря.
 */
type StartedHandler = (started: Awaited<ReturnType<typeof startMatch>>) => void
let onMatchStarted: StartedHandler | null = null

export function setMatchStartAnnouncer(handler: StartedHandler): void {
  onMatchStarted = handler
}

/**
 * Люди приходят и уходят.
 *
 * Список из тридцати боёв, который не меняется, — это не толпа, это витрина.
 * Живой список опознаётся не количеством, а движением: одни строки исчезают,
 * появляются другие, с другими именами. Поэтому на каждом круге небольшая
 * часть боёв снимается — как будто человек передумал ждать и закрыл игру, —
 * а следом topUpOpenMatches открывает столько же новых, уже другими ботами.
 *
 * Снимаем только те, что провисели не меньше минуты: иначе бой мог бы
 * исчезнуть под пальцем у того, кто как раз до него дотянулся.
 */
const CHURN_MIN_AGE_SEC = 60

export async function churnOpenMatches(settings: BotSettings): Promise<number> {
  if (!settings.enabled) return 0

  // Примерно десятая часть за круг: за несколько минут состав обновляется
  // целиком, но список при этом ни на секунду не пустеет.
  const count = Math.max(1, Math.round(settings.openMatches * 0.1))

  const rows = await query<{ id: number }>(
    `UPDATE matches m
        SET status = 'cancelled', finished_at = now()
      WHERE m.id IN (
        SELECT m2.id
          FROM matches m2
          JOIN users u2 ON u2.id = m2.player1_id
         WHERE u2.is_bot = TRUE
           AND m2.status = 'searching'
           AND m2.player2_id IS NULL
           AND m2.created_at < now() - ($1::int * INTERVAL '1 second')
         ORDER BY random()
         LIMIT $2)
      RETURNING m.id`,
    [CHURN_MIN_AGE_SEC, count],
  )
  return rows.length
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
