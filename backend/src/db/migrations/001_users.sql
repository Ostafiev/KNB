-- Игроки.
--
-- Регистрация автоматическая: при первом входе сервер проверяет подпись initData
-- и заводит запись (ЧАСТЬ 3, п.7). Отдельной формы регистрации нет — только шаг
-- выбора игрового ника и аватара плюс экран согласия.

CREATE TABLE users (
  id                    BIGSERIAL PRIMARY KEY,

  -- Данные из Telegram
  telegram_id           BIGINT      NOT NULL UNIQUE,
  telegram_username     TEXT,
  telegram_first_name   TEXT,
  telegram_last_name    TEXT,
  telegram_photo_url    TEXT,

  -- Игровой профиль
  nickname              TEXT        NOT NULL,
  avatar_id             TEXT        NOT NULL DEFAULT 'gamepad',
  language              TEXT        NOT NULL DEFAULT 'ru',
  theme                 TEXT,
  sound_enabled         BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Рейтинг и статистика. Стартовый рейтинг — ЧАСТЬ 5.
  rating                INTEGER     NOT NULL DEFAULT 1000,
  games_played          INTEGER     NOT NULL DEFAULT 0,
  wins                  INTEGER     NOT NULL DEFAULT 0,
  losses                INTEGER     NOT NULL DEFAULT 0,
  draws                 INTEGER     NOT NULL DEFAULT 0,

  -- Баланс медяков. Денормализованный кэш: источник истины — сумма transactions.
  -- Сверка обеими сторонами делается регулярной задачей.
  coins_balance         BIGINT      NOT NULL DEFAULT 0,

  -- Рефералы
  referred_by           BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  referral_code         TEXT        NOT NULL UNIQUE,

  -- Бонусы
  last_daily_bonus_on   DATE,

  -- Согласие с условиями (ЧАСТЬ 2, п.13). Дублируем на сервере, чтобы согласие
  -- переживало смену устройства и очистку памяти браузера.
  consent_accepted_at   TIMESTAMPTZ,

  -- Модерация
  banned_at             TIMESTAMPTZ,
  ban_reason            TEXT,

  -- Античит: лимит аккаунтов с одного устройства (ЧАСТЬ 3, п.5)
  signup_ip             INET,
  device_fingerprint    TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT users_balance_non_negative CHECK (coins_balance >= 0),
  CONSTRAINT users_language_known       CHECK (language IN ('ru', 'en')),
  CONSTRAINT users_theme_known          CHECK (theme IS NULL OR theme IN ('dark', 'light'))
);

CREATE INDEX users_referred_by_idx      ON users (referred_by) WHERE referred_by IS NOT NULL;
CREATE INDEX users_rating_idx           ON users (rating DESC);
CREATE INDEX users_last_seen_idx        ON users (last_seen_at DESC);
CREATE INDEX users_banned_idx           ON users (banned_at) WHERE banned_at IS NOT NULL;
-- Поиск по нику и юзернейму в админке
CREATE INDEX users_nickname_lower_idx   ON users (lower(nickname));
CREATE INDEX users_username_lower_idx   ON users (lower(telegram_username));
-- Для лимита аккаунтов с устройства
CREATE INDEX users_fingerprint_idx      ON users (device_fingerprint) WHERE device_fingerprint IS NOT NULL;
