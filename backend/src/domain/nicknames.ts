import { randomInt } from 'node:crypto'

/**
 * Ники в том виде, в каком люди сами себя называют в сети.
 *
 * Раньше боты подписывались «Артём К.» — паспортным именем с инициалом. Так
 * не подписывается почти никто, и на фоне живых игроков это бросалось в глаза:
 * список выглядел как перепись, а не как игроки. Ник вроде `nik99` не выдаёт
 * ни бота, ни человека — он просто ничего о себе не сообщает.
 *
 * Тот же генератор предлагается и живому игроку при входе: кто не хочет
 * светить имя из Telegram, получает ник в общем стиле — и тогда никого нельзя
 * опознать по одному только виду подписи.
 */

/** Короткие основы — то, что обычно остаётся от имени в нике. */
const STEMS = [
  'nik', 'max', 'dan', 'den', 'lex', 'kir', 'ilya', 'egor', 'rom', 'pash',
  'tim', 'mark', 'vlad', 'anton', 'sanya', 'zhenya', 'artem', 'seva', 'gosha',
  'ann', 'mash', 'olya', 'dasha', 'polya', 'yulya', 'ksu', 'alina', 'vera',
  'liza', 'nastya', 'katya', 'sonya', 'eva', 'mila', 'kira', 'alya',
  'foxy', 'zippy', 'lucky', 'shadow', 'ghost', 'rocky', 'nova', 'echo',
  'pixel', 'turbo', 'mango', 'kiwi', 'storm', 'frost', 'sunny', 'jazz',
]

/** Изредка — второй кусок вместо цифр: так ники не выглядят однотипными. */
const TAILS = ['pro', 'x', 'one', 'ok', 'top', 'go', 'win', 'zz', 'ka', 'off']

function pick<T>(list: T[]): T {
  return list[randomInt(list.length)]
}

/**
 * Один ник. Форма выбирается случайно, чтобы список не выглядел
 * сгенерированным по одному шаблону.
 */
export function randomNickname(): string {
  const stem = pick(STEMS)
  const capitalized = randomInt(2) === 0 ? stem[0].toUpperCase() + stem.slice(1) : stem

  switch (randomInt(6)) {
    case 0:
      // nik99
      return `${capitalized}${10 + randomInt(90)}`
    case 1:
      // max_04 — ведущий ноль читается как «человек выбирал сам»
      return `${capitalized}_${String(randomInt(100)).padStart(2, '0')}`
    case 2:
      // Alex7
      return `${capitalized}${randomInt(10)}`
    case 3:
      // kir_pro
      return `${capitalized}_${pick(TAILS)}`
    case 4:
      // foxy2024 — год рождения или просто год
      return `${capitalized}${1990 + randomInt(20)}`
    default:
      // sonyaka
      return `${capitalized}${pick(TAILS)}`
  }
}

/**
 * Ник, которого ещё нет.
 *
 * Совпадения не запрещены правилами, но два одинаковых ника в одном списке
 * читаются как сбой. Несколько попыток, дальше — с цифрой на конце, чтобы
 * генератор никогда не возвращал пустоту.
 */
export async function uniqueNickname(
  taken: (nickname: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomNickname()
    if (!(await taken(candidate))) return candidate
  }
  return `${randomNickname()}${randomInt(1000)}`
}
