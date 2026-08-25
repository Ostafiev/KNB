/*
 * Заявки на вывод медяков в TON (ЧАСТЬ 3, п.3 и ЧАСТЬ 6, п.4).
 *
 * На первых порах выводы подтверждаются в админке вручную, поэтому заявка
 * живёт отдельной сущностью со своим статусом, а не одной строкой в журнале.
 * Порог из ЧАСТИ 5 — минимум 15 сыгранных матчей и минимум 500 медяков —
 * проверяется сервером в момент создания заявки, оба условия одновременно.
 */

CREATE TYPE withdrawal_status AS ENUM ('pending', 'approved', 'rejected', 'sent', 'failed');

CREATE TABLE withdrawals (
  id               BIGSERIAL PRIMARY KEY,

  user_id          BIGINT            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  coins_amount     BIGINT            NOT NULL,
  -- Комиссия проекта удерживается при выводе, а не с каждой партии (ЧАСТЬ 5)
  fee_percent      NUMERIC(5, 2)     NOT NULL,
  fee_coins        BIGINT            NOT NULL,
  -- Сумма к отправке после удержания комиссии, в нанотонах
  ton_nano         BIGINT            NOT NULL,
  -- Курс на момент заявки: медяков за 1 TON
  rate_coins_per_ton INTEGER         NOT NULL,

  wallet_address   TEXT              NOT NULL,

  status           withdrawal_status NOT NULL DEFAULT 'pending',
  tx_hash          TEXT,
  failure_reason   TEXT,

  processed_by     BIGINT,
  requested_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,

  CONSTRAINT withdrawals_amount_positive CHECK (coins_amount > 0),
  CONSTRAINT withdrawals_fee_sane        CHECK (fee_percent >= 0 AND fee_percent <= 100)
);

CREATE INDEX withdrawals_pending_idx ON withdrawals (requested_at) WHERE status = 'pending';
CREATE INDEX withdrawals_user_idx    ON withdrawals (user_id, requested_at DESC);
