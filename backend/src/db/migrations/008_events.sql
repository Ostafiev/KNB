/*
 * События поведения игроков.
 *
 * Отвечают на вопрос «сколько» для дашборда админки: DAU/MAU, воронка от входа
 * до первой ставки, доля тех, кто досмотрел рекламу. Внешнюю аналитику
 * (Amplitude, PostHog и подобные) подключим позже для вопроса «почему» —
 * воронки и когорты своей таблицей строить неудобно.
 *
 * Таблица заведена сразу, с первого этапа: данные, которые не собирали,
 * потом не восстановишь.
 */

CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,

  user_id     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  -- Имя события: app_open, match_start, bet_placed, ad_watched, topup_opened…
  name        TEXT        NOT NULL,
  -- Произвольные детали: ставка, количество раундов, экран, источник перехода
  props       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Идентификатор сессии приложения — чтобы склеивать шаги одного захода
  session_id  TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_name_created_idx ON events (name, created_at DESC);
CREATE INDEX events_user_created_idx ON events (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX events_created_idx      ON events (created_at DESC);
CREATE INDEX events_session_idx      ON events (session_id) WHERE session_id IS NOT NULL;

/*
 * Ежедневная активность. Одна строка на игрока в сутки — из неё считаются
 * DAU и MAU без перебора всей таблицы событий.
 */
CREATE TABLE daily_active_users (
  day        DATE   NOT NULL,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matches    INTEGER NOT NULL DEFAULT 0,
  wagered    BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);

CREATE INDEX daily_active_users_day_idx ON daily_active_users (day DESC);
