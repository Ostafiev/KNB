/**
 * Параметры экономики — ЧАСТЬ 5 техзадания.
 *
 * TODO(backend/admin): все эти значения должны приходить с сервера через GET /api/config
 * и редактироваться в админ-панели без пересборки приложения (ЧАСТЬ 6, п.5).
 * До появления бэкенда используются как константы по умолчанию.
 */
export interface Economy {
  MIN_BET: number
  MAX_BET: number
  BET_STEP: number
  BET_PRESETS: number[]
  FREE_BET: number
  SIGNUP_BONUS: number
  DAILY_BONUS: number
  REFERRAL_INVITER_BONUS: number
  REFERRAL_INVITEE_BONUS: number
  AD_REWARD: number
  COINS_PER_TON: number
  COINS_PER_STAR: number
  WITHDRAW_MIN_COINS: number
  WITHDRAW_MIN_GAMES: number
  ELO_START: number
  ELO_K: number
  ROUND_SECONDS: number
  ROUNDS_OPTIONS: number[]
}

export const ECONOMY: Economy = {
  // ─── Ставки ───────────────────────────────────────────────────────────────
  /** Диапазон ставок за матч: 25–500 медяков. */
  MIN_BET: 25,
  MAX_BET: 500,
  BET_STEP: 5,
  BET_PRESETS: [25, 50, 100, 250, 500],
  /**
   * Бесплатная игра (правка 20).
   * Ставка 0 разрешена ТОЛЬКО в матчах с друзьями и по приглашению.
   * В случайном матчмейкинге минимум остаётся MIN_BET.
   */
  FREE_BET: 0,

  // ─── Бонусы ───────────────────────────────────────────────────────────────
  /** Новый пользователь получает при первом входе. */
  SIGNUP_BONUS: 100,
  /** Ежедневный бесплатный бонус. */
  DAILY_BONUS: 20,
  /** Пригласившему — после первого матча приглашённого. */
  REFERRAL_INVITER_BONUS: 100,
  /** Приглашённому — стартовые. */
  REFERRAL_INVITEE_BONUS: 50,
  /** За просмотр rewarded-рекламы. */
  AD_REWARD: 20,

  // ─── Курсы конвертации ────────────────────────────────────────────────────
  COINS_PER_TON: 1000,
  COINS_PER_STAR: 7.5,

  // ─── Порог вывода (антифрод) ──────────────────────────────────────────────
  WITHDRAW_MIN_COINS: 500,
  WITHDRAW_MIN_GAMES: 15,

  // ─── Рейтинг Elo ──────────────────────────────────────────────────────────
  ELO_START: 1000,
  ELO_K: 28,

  // ─── Матч ─────────────────────────────────────────────────────────────────
  /** Секунд на выбор фигуры в раунде. */
  ROUND_SECONDS: 10,
  /**
   * Варианты количества раундов — только нечётные (правка 9).
   * При чётном числе матч слишком часто заканчивается ничьёй.
   */
  ROUNDS_OPTIONS: [1, 3, 5, 7, 9],
}

/**
 * Подменяет значения теми, что пришли с сервера (GET /api/config).
 *
 * Объект намеренно меняется на месте, а не пересоздаётся: на него уже
 * ссылаются все экраны, и так правка курса в админке доезжает до интерфейса
 * при следующей перерисовке, без прокидывания конфигурации через всё дерево.
 */
export function applyServerEconomy(server: {
  minBet: number
  maxBet: number
  signupBonus: number
  dailyBonus: number
  referralInviterBonus: number
  referralInviteeBonus: number
  adReward: number
  coinsPerTon: number
  coinsPerStar: number
  withdrawMinCoins: number
  withdrawMinGames: number
  eloStart: number
  eloK: number
  roundSeconds: number
}): void {
  ECONOMY.MIN_BET = server.minBet
  ECONOMY.MAX_BET = server.maxBet
  ECONOMY.SIGNUP_BONUS = server.signupBonus
  ECONOMY.DAILY_BONUS = server.dailyBonus
  ECONOMY.REFERRAL_INVITER_BONUS = server.referralInviterBonus
  ECONOMY.REFERRAL_INVITEE_BONUS = server.referralInviteeBonus
  ECONOMY.AD_REWARD = server.adReward
  ECONOMY.COINS_PER_TON = server.coinsPerTon
  ECONOMY.COINS_PER_STAR = server.coinsPerStar
  ECONOMY.WITHDRAW_MIN_COINS = server.withdrawMinCoins
  ECONOMY.WITHDRAW_MIN_GAMES = server.withdrawMinGames
  ECONOMY.ELO_START = server.eloStart
  ECONOMY.ELO_K = server.eloK
  ECONOMY.ROUND_SECONDS = server.roundSeconds
  // Пресеты держим внутри разрешённого диапазона
  ECONOMY.BET_PRESETS = ECONOMY.BET_PRESETS.filter(
    (p) => p >= server.minBet && p <= server.maxBet,
  )
}

/** Победа в матче — первый, кто набрал большинство раундов. */
export function roundsToWin(roundsTotal: number): number {
  return Math.floor(roundsTotal / 2) + 1
}

/** Ожидаемая вероятность победы по стандартной логистической формуле Elo. */
export function eloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

/**
 * Пересчёт рейтинга: R_A' = R_A + K * (S_A - E_A).
 * Используется на клиенте только для предпросмотра прироста.
 * TODO(backend): единственный источник истины по рейтингу — сервер.
 */
export function eloUpdate(ratingA: number, ratingB: number, score: number, k = ECONOMY.ELO_K): number {
  return Math.round(ratingA + k * (score - eloExpected(ratingA, ratingB)))
}
