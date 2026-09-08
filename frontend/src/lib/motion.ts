/**
 * Плавный режим.
 *
 * Украшения — свечения, покачивания, выезжающие блоки — стоят кадров. На
 * хорошем телефоне это незаметно, на слабом складывается в рывки. Системная
 * настройка «уменьшить движение» есть у всех, но лежит глубоко, и человек,
 * которому просто дёргается игра, до неё не дойдёт.
 *
 * Поэтому тот же выключатель живёт в профиле. Выбор запоминается в браузере:
 * он про это устройство, а не про игрока — с телефона может быть тяжело,
 * а с компьютера того же человека нормально.
 */

const KEY = 'knb.motion'

export type MotionMode = 'full' | 'calm'

export function readMotion(): MotionMode {
  try {
    return localStorage.getItem(KEY) === 'calm' ? 'calm' : 'full'
  } catch {
    // Приватный режим: настройку негде хранить, остаёмся с украшениями.
    return 'full'
  }
}

export function applyMotion(mode: MotionMode): void {
  if (typeof document === 'undefined') return
  if (mode === 'calm') {
    document.documentElement.setAttribute('data-motion', 'calm')
  } else {
    document.documentElement.removeAttribute('data-motion')
  }
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* не сохранилось — но в этой сессии режим всё равно работает */
  }
}
