/*
 * Админ-панель (ЧАСТЬ 6).
 *
 * Вход отдельным логином владельца, не через Telegram — иначе доступ к панели
 * зависел бы от аккаунта в мессенджере.
 */

CREATE TABLE admins (
  id             BIGSERIAL PRIMARY KEY,
  login          TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  display_name   TEXT        NOT NULL,
  disabled_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

/*
 * Журнал действий администратора (ЧАСТЬ 6, требование «для собственной защиты
 * от ошибок»). Пишется на каждое изменение баланса, бан, правку конфигурации
 * и решение по выводу.
 */
CREATE TABLE admin_audit (
  id           BIGSERIAL PRIMARY KEY,
  admin_id     BIGINT      NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  action       TEXT        NOT NULL,
  target_type  TEXT,
  target_id    BIGINT,
  -- Что было до и что стало после — чтобы ошибку можно было откатить руками
  before       JSONB,
  after        JSONB,
  comment      TEXT,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_admin_idx  ON admin_audit (admin_id, created_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit (target_type, target_id, created_at DESC);
CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC);

/*
 * Параметры экономики (ЧАСТЬ 6, п.5) — редактируются в админке без пересборки
 * приложения. Фронт получает их через GET /api/config, сервер держит в кэше.
 */
CREATE TABLE app_config (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  description TEXT,
  updated_by  BIGINT      REFERENCES admins(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Значения по умолчанию из ЧАСТИ 5
INSERT INTO app_config (key, value, description) VALUES
  ('coins_per_ton',          '1000',  'Медяков за 1 TON'),
  ('coins_per_star',         '7.5',   'Медяков за 1 звезду Telegram'),
  ('min_bet',                '25',    'Минимальная ставка за матч'),
  ('max_bet',                '500',   'Максимальная ставка за матч'),
  ('signup_bonus',           '100',   'Бонус новому игроку'),
  ('daily_bonus',            '20',    'Ежедневный бонус'),
  ('referral_inviter_bonus', '100',   'Пригласившему, после первого матча приглашённого'),
  ('referral_invitee_bonus', '50',    'Приглашённому, стартовые'),
  ('ad_reward',              '20',    'За просмотр rewarded-рекламы'),
  ('withdraw_min_coins',     '500',   'Минимальная сумма вывода в медяках'),
  ('withdraw_min_games',     '15',    'Минимум сыгранных матчей до разблокировки вывода'),
  ('withdraw_fee_percent',   '5',     'Комиссия проекта при выводе, процент'),
  ('elo_k',                  '28',    'Коэффициент чувствительности рейтинга Elo'),
  ('elo_start',              '1000',  'Стартовый рейтинг нового игрока'),
  ('round_seconds',          '10',    'Секунд на выбор фигуры в раунде'),
  ('min_reaction_ms',        '120',   'Античит: быстрее этого ход считается ботом');
