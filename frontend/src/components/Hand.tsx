import { HAND_EMOJI } from '../lib/game'
import type { HandChoice } from '../types'

export type HandSide = 'left' | 'right'

/**
 * Рука в арене боя.
 *
 * Правка 1/3 из «Правки V3»: фигуры показываются боком, зеркально, навстречу
 * друг другу — рука соперника слева развёрнута вправо, рука игрока справа влево.
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
  const rotation = side === 'left' ? 90 : -90
  return (
    <span className={className} style={{ display: 'inline-block', ...style }}>
      <span style={{ display: 'inline-block', transform: `rotate(${rotation}deg)` }}>
        {HAND_EMOJI[choice]}
      </span>
    </span>
  )
}
