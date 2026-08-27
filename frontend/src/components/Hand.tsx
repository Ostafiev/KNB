import { HAND_EMOJI } from '../lib/game'
import type { HandChoice } from '../types'

export type HandSide = 'left' | 'right'

/**
 * Рука в арене боя.
 *
 * Обе руки — зеркальное отражение друг друга, как в жизни: два человека
 * сидят напротив и выбрасывают правую руку. Раньше левая просто крутилась
 * в другую сторону и выглядела вывернутой; теперь она — тот же поворот
 * плюс отражение по горизонтали.
 *
 * Поворот живёт на внутреннем span, чтобы не конфликтовать с transform,
 * который задают анимации (тряска, столкновение) на внешнем элементе.
 */
export function Hand({
  choice,
  side,
  className = '',
  style,
}: {
  choice: HandChoice
  side: HandSide
  className?: string
  style?: React.CSSProperties
}) {
  const transform = side === 'left' ? 'scaleX(-1) rotate(-90deg)' : 'rotate(-90deg)'
  return (
    <span className={className} style={{ display: 'inline-block', ...style }}>
      <span style={{ display: 'inline-block', transform }}>{HAND_EMOJI[choice]}</span>
    </span>
  )
}
