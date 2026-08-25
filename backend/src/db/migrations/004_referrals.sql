/*
 * Реферальная программа (ЧАСТЬ 3, п.6).
 *
 * Пригласивший получает бонус не за переход по ссылке, а после того, как
 * приглашённый сыграл свой первый матч. Иначе программу накручивают пустыми
 * регистрациями.
 */

CREATE TABLE referrals (
  id                BIGSERIAL PRIMARY KEY,

  referrer_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Бонус пригласившему: выплачен ли и когда
  bonus_paid        BOOLEAN     NOT NULL DEFAULT FALSE,
  bonus_paid_at     TIMESTAMPTZ,
  -- Матч, который разблокировал выплату
  qualifying_match_id BIGINT    REFERENCES matches(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Приглашённый может быть засчитан только одному пригласившему
  CONSTRAINT referrals_referred_unique UNIQUE (referred_id),
  CONSTRAINT referrals_no_self         CHECK (referrer_id <> referred_id)
);

CREATE INDEX referrals_referrer_idx ON referrals (referrer_id, created_at DESC);
CREATE INDEX referrals_pending_idx  ON referrals (referrer_id) WHERE bonus_paid = FALSE;
