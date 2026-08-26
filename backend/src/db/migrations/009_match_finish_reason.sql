/*
 * Почему матч закончился.
 *
 * 'played'    — доиграли до победы по раундам
 * 'abandoned' — один из игроков вышел, второму засчитана победа
 *
 * Нужно и приложению (показать «соперник вышел» вместо выдуманного разгрома),
 * и админке при разборе жалоб.
 */

ALTER TABLE matches
  ADD COLUMN finish_reason TEXT;

ALTER TABLE matches
  ADD CONSTRAINT matches_finish_reason_known
  CHECK (finish_reason IS NULL OR finish_reason IN ('played', 'abandoned'));

/*
 * Раунд, брошенный игроком, отличается от раунда, где просто не успели нажать:
 * во втором случае игрок был на связи и таймер честно истёк.
 */
ALTER TABLE rounds
  ADD COLUMN abandoned BOOLEAN NOT NULL DEFAULT FALSE;
