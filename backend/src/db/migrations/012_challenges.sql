/*
 * Вызов на бой.
 *
 * Раньше позвать друга можно было только ссылкой: отправил, он открыл, вошёл.
 * Теперь вызов — это тот же матч с mode='friend' и status='pending', но с
 * двумя добавками: известно, кого зовут, и известно, до какого момента вызов
 * действителен.
 *
 * Отдельной таблицы нет намеренно. Вызов — это и есть матч, который ещё не
 * начался; заводить под него вторую сущность значило бы держать две правды
 * об одном и том же и однажды их рассинхронизировать.
 */

ALTER TABLE matches
  ADD COLUMN invited_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

/*
 * Персональный вызов нельзя перехватить: войти в такой матч может только тот,
 * кого позвали. Приглашение ссылкой (invited_id IS NULL) по-прежнему открыто
 * любому, кто эту ссылку получил.
 */
ALTER TABLE matches
  ADD CONSTRAINT matches_invite_not_self
  CHECK (invited_id IS NULL OR invited_id <> player1_id);

ALTER TABLE matches
  ADD CONSTRAINT matches_invite_only_friend
  CHECK (invited_id IS NULL OR mode = 'friend');

/*
 * До какого момента вызов ждёт ответа. Без срока приглашения копились бы
 * у человека на экране неделями.
 */
ALTER TABLE matches
  ADD COLUMN expires_at TIMESTAMPTZ;

CREATE INDEX matches_invited_idx
  ON matches (invited_id, status)
  WHERE invited_id IS NOT NULL;

CREATE INDEX matches_expiring_idx
  ON matches (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'pending';
