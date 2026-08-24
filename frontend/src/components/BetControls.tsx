import { useEffect, useState } from 'react'
import { ECONOMY } from '../config/economy'
import { useT } from '../i18n'
import { hapticSelection } from '../telegram/sdk'

function clampBet(value: number): number {
  if (Number.isNaN(value)) return ECONOMY.MIN_BET
  return Math.min(ECONOMY.MAX_BET, Math.max(ECONOMY.MIN_BET, Math.round(value)))
}

/**
 * Ставка: ползунок + ручной ввод числа + пресеты.
 * Диапазон 25–500 медяков зафиксирован в ЧАСТИ 5.
 */
export function BetSlider({
  value,
  onChange,
  compact = false,
}: {
  value: number
  onChange: (next: number) => void
  compact?: boolean
}) {
  // Отдельный стейт для поля ввода, чтобы можно было временно стереть значение.
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  const commitDraft = () => {
    const next = clampBet(Number(draft))
    onChange(next)
    setDraft(String(next))
  }

  const fill = ((value - ECONOMY.MIN_BET) / (ECONOMY.MAX_BET - ECONOMY.MIN_BET)) * 100

  return (
    <div className="flex flex-col gap-3">
      {/* Ручной ввод числа — крупным, он же индикатор текущего значения */}
      <div className="flex items-center justify-center gap-3">
        <span className={compact ? 'text-2xl' : 'text-3xl'}>🪙</span>
        <input
          type="number"
          inputMode="numeric"
          value={draft}
          min={ECONOMY.MIN_BET}
          max={ECONOMY.MAX_BET}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`bg-transparent text-tg-yellow font-black text-center outline-none ${compact ? 'text-3xl w-24' : 'text-4xl w-32'}`}
          aria-label="Ставка"
        />
      </div>

      <input
        type="range"
        min={ECONOMY.MIN_BET}
        max={ECONOMY.MAX_BET}
        step={ECONOMY.BET_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-input w-full cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--tg-yellow) ${fill}%, var(--tg-fill-2) ${fill}%)`,
        }}
      />

      <div className="flex gap-2 flex-wrap justify-center">
        {ECONOMY.BET_PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => {
              hapticSelection()
              onChange(preset)
            }}
            className="tappable rounded-xl px-3 py-1.5 text-sm font-bold transition-all duration-150"
            style={{
              background: value === preset ? 'var(--tg-yellow)' : 'var(--tg-fill)',
              color: value === preset ? 'var(--tg-on-yellow)' : 'var(--tg-subtext)',
            }}
          >
            {preset} 🪙
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Выбор количества раундов.
 * `max` = 10 для приглашения друга (ЧАСТЬ 2, п.10), 5 для обычного подбора.
 */
export function RoundsPicker({
  value,
  onChange,
  max = 5,
}: {
  value: number
  onChange: (next: number) => void
  max?: number
}) {
  const t = useT()
  // Раундов всегда нечётное число — иначе матч слишком часто заканчивается ничьёй.
  const options: number[] = []
  for (let n = 1; n <= max; n += 2) options.push(n)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap">
        {options.map((n) => (
          <button
            key={n}
            onClick={() => {
              hapticSelection()
              onChange(n)
            }}
            className="tappable rounded-xl px-4 py-2 text-sm font-bold transition-all duration-150 min-w-11"
            style={{
              background: value === n ? 'var(--tg-blue)' : 'var(--tg-fill)',
              color: value === n ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {max > 5 && (
        <div className="text-tg-subtext text-xs">{t('invite.rounds.max', { max })}</div>
      )}
    </div>
  )
}
