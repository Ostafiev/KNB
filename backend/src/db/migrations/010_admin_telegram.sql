/*
 * Вход в админку через Telegram.
 *
 * Изначально предполагался отдельный логин с паролем. От пароля отказались:
 * панель двигает балансы игроков, а подобранный пароль здесь означает чужие
 * деньги. Вход по Telegram-аккаунту нечего украсть, и в журнале действий
 * видно живого человека, а не безликого «admin».
 *
 * Колонки логина и пароля остаются: способ входа может понадобиться там,
 * где Telegram недоступен.
 */

ALTER TABLE admins
  ADD COLUMN telegram_id BIGINT UNIQUE;

ALTER TABLE admins
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE admins
  ADD CONSTRAINT admins_has_login_method
  CHECK (password_hash IS NOT NULL OR telegram_id IS NOT NULL);
