-- Матчи и раунды.

CREATE TYPE match_mode   AS ENUM ('random', 'friend');
CREATE TYPE match_status AS ENUM ('pending', 'searching', 'active', 'finished', 'cancelled', 'expired');

CREATE TABLE matches (
  id              BIGSERIAL PRIMARY KEY,

  mode            match_mode   NOT NULL,
  status          match_status NOT NULL DEFAULT 'pending',

  player1_id      BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  player2_id      BIGINT       REFERENCES users(id) ON DELETE RESTRICT,

  -- Ставка в медяках. 0 — бесплатный матч, он разрешён только при mode='friend'
  -- и не влияет на баланс, рейтинг и счётчик сыгранных игр.
  bet_amount      BIGINT       NOT NULL,
  rounds_total    SMALLINT     NOT NULL,

  -- Текстовое условие пари. Только для матчей с друзьями (ЧАСТЬ 2, п.11):
  -- в случайном подборе его нельзя модерировать.
  condition       TEXT,

  -- Итог
  winner_id       BIGINT       REFERENCES users(id) ON DELETE SET NULL,
  score1          SMALLINT     NOT NULL DEFAULT 0,
  score2          SMALLINT     NOT NULL DEFAULT 0,
  rating1_delta   INTEGER      NOT NULL DEFAULT 0,
  rating2_delta   INTEGER      NOT NULL DEFAULT 0,

  -- Реванш: ссылка на матч, из которого этот вырос
  rematch_of      BIGINT       REFERENCES matches(id) ON DELETE SET NULL,

  -- Блокировка матча модератором (ЧАСТЬ 6, п.3)
  blocked_at      TIMESTAMPTZ,
  blocked_reason  TEXT,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,

  CONSTRAINT matches_bet_non_negative  CHECK (bet_amount >= 0),
  CONSTRAINT matches_rounds_odd        CHECK (rounds_total > 0 AND rounds_total % 2 = 1),
  CONSTRAINT matches_free_only_friend  CHECK (bet_amount > 0 OR mode = 'friend'),
  CONSTRAINT matches_condition_friend  CHECK (condition IS NULL OR mode = 'friend'),
  CONSTRAINT matches_players_differ    CHECK (player2_id IS NULL OR player1_id <> player2_id)
);

CREATE INDEX matches_player1_idx  ON matches (player1_id, created_at DESC);
CREATE INDEX matches_player2_idx  ON matches (player2_id, created_at DESC);
CREATE INDEX matches_status_idx   ON matches (status, created_at DESC);
-- Для метрики «матчей в день» в админке
CREATE INDEX matches_finished_idx ON matches (finished_at DESC) WHERE finished_at IS NOT NULL;

CREATE TYPE round_result AS ENUM ('player1', 'player2', 'draw');
CREATE TYPE hand_choice  AS ENUM ('rock', 'scissors', 'paper');

CREATE TABLE rounds (
  id                BIGSERIAL PRIMARY KEY,

  match_id          BIGINT       NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round_number      SMALLINT     NOT NULL,

  player1_choice    hand_choice,
  player2_choice    hand_choice,

  /*
   * Античит (ЧАСТЬ 3, п.5): сервер сам штампует момент старта раунда и момент
   * прихода каждого хода. Разница меньше физически возможного времени реакции
   * означает бота. Клиентским временам не верим — они не сохраняются вовсе.
   */
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  player1_move_at   TIMESTAMPTZ,
  player2_move_at   TIMESTAMPTZ,
  -- Ход подставлен сервером по истечении таймера, а не сделан игроком
  player1_timed_out BOOLEAN      NOT NULL DEFAULT FALSE,
  player2_timed_out BOOLEAN      NOT NULL DEFAULT FALSE,

  result            round_result,
  resolved_at       TIMESTAMPTZ,

  CONSTRAINT rounds_unique_number UNIQUE (match_id, round_number),
  CONSTRAINT rounds_number_positive CHECK (round_number > 0)
);

CREATE INDEX rounds_match_idx ON rounds (match_id, round_number);
