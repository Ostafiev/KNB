-- Жалобы на игроков и очередь модерации (ЧАСТЬ 6, п.3).

CREATE TYPE report_reason AS ENUM ('cheating', 'condition', 'nickname', 'other');
CREATE TYPE report_status AS ENUM ('open', 'resolved', 'rejected');

CREATE TABLE reports (
  id                BIGSERIAL PRIMARY KEY,

  reporter_id       BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id  BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id          BIGINT        REFERENCES matches(id) ON DELETE SET NULL,

  reason            report_reason NOT NULL,
  comment           TEXT,

  status            report_status NOT NULL DEFAULT 'open',
  resolved_by       BIGINT,
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT reports_no_self CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX reports_open_idx     ON reports (created_at DESC) WHERE status = 'open';
CREATE INDEX reports_reported_idx ON reports (reported_user_id, created_at DESC);

-- Обратная связь из меню приложения
CREATE TYPE feedback_category AS ENUM ('bug', 'idea', 'other');

CREATE TABLE feedback (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT            REFERENCES users(id) ON DELETE SET NULL,
  category    feedback_category NOT NULL,
  text        TEXT              NOT NULL,
  handled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX feedback_new_idx ON feedback (created_at DESC) WHERE handled_at IS NULL;
