/*
 * Журнал движения медяков.
 *
 * Это единственное место, где меняется баланс. Каждая операция пишет строку
 * здесь и обновляет users.coins_balance в одной транзакции БД — иначе при
 * первом же споре «куда делись медяки» разбираться будет нечем.
 *
 * amount — знаковая величина: положительная это начисление, отрицательная списание.
 * balance_after хранит баланс сразу после операции, чтобы историю можно было
 * читать без пересчёта всей цепочки.
 */

CREATE TYPE transaction_type AS ENUM (
  'signup_bonus',      -- 100 медяков новому игроку (ЧАСТЬ 5)
  'daily_bonus',       -- 20 медяков в день
  'referral_bonus',    -- 100 пригласившему после первого матча приглашённого
  'referral_signup',   -- 50 стартовых приглашённому
  'ad_reward',         -- за просмотр rewarded-рекламы
  'bet_hold',          -- ставка списана при старте матча
  'bet_refund',        -- ставка возвращена: ничья или отменённый матч
  'match_win',         -- выигрыш забран
  'topup_stars',       -- пополнение звёздами Telegram
  'topup_ton',         -- пополнение в TON
  'withdrawal',        -- вывод в TON
  'withdrawal_fee',    -- комиссия проекта, удерживается при выводе
  'admin_adjustment'   -- ручная правка баланса из админки
);

CREATE TABLE transactions (
  id             BIGSERIAL PRIMARY KEY,

  user_id        BIGINT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type           transaction_type NOT NULL,

  amount         BIGINT           NOT NULL,
  balance_after  BIGINT           NOT NULL,

  match_id       BIGINT           REFERENCES matches(id) ON DELETE SET NULL,

  /*
   * Идемпотентность. Внешний идентификатор операции: номер платежа Telegram,
   * хеш TON-транзакции, идентификатор просмотра рекламы. Уникальность не даёт
   * начислить дважды, если провайдер повторит уведомление.
   */
  external_id    TEXT UNIQUE,

  -- Кто провёл ручную операцию и почему
  admin_id       BIGINT,
  comment        TEXT,

  meta           JSONB            NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT transactions_amount_not_zero   CHECK (amount <> 0),
  CONSTRAINT transactions_balance_positive  CHECK (balance_after >= 0)
);

CREATE INDEX transactions_user_idx   ON transactions (user_id, created_at DESC);
CREATE INDEX transactions_type_idx   ON transactions (type, created_at DESC);
CREATE INDEX transactions_match_idx  ON transactions (match_id) WHERE match_id IS NOT NULL;
-- Для финансового раздела админки: выручка за период
CREATE INDEX transactions_created_idx ON transactions (created_at DESC);

-- Не более одного ежедневного бонуса в сутки на игрока, на уровне базы
CREATE UNIQUE INDEX transactions_daily_bonus_once
  ON transactions (user_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE type = 'daily_bonus';
