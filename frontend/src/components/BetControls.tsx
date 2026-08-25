import { useEffect, useState } from 'react'
import { ECONOMY } from '../config/economy'
import { useT } from '../i18n'
import { hapticSelection } from '../telegram/sdk'

/**
 * Ставка: ползунок + ручной ввод числа + пресеты.
 * Диапазон 25–500 медяков зафиксирован в ЧАСТИ 5.
 *
 * `allowFree` разрешает ставку 0 — бесплатная игра, доступная только
 * в матчах с друзьями и по приглашению (правка 20).
 */
export function BetSlider({
  value,
  onChange,
  compact = false,
  allowFree = false,
}: {
  value: number
  onChange: (next: number) => void
  compact?: boolean
  allowFree?: boolean
}) {
  const t = useT()
  // Отдельный стейт для поля ввода, чтобы можно было временно стереть значение.
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  const min = allowFree ? ECONOMY.FREE_BET : ECONOMY.MIN_BET

  const clampBet = (raw: number): number => {
    if (Number.isNaN(raw)) return min
    const rounded = Math.round(raw)
    // Между 0 и минимальной ставкой значений нет: либо бесплатно, либо от 25.
    if (allowFree && rounded < ECONOMY.MIN_BET) {
      return rounded <= ECONOMY.MIN_BET / 2 ? ECONOMY.FREE_BET : ECONOMY.MIN_BET
    }
    return Math.min(ECONOMY.MAX_BET, Math.max(min, rounded))
  }

  const commitDraft = () => {
    const next = clampBet(Number(draft))
    onChange(next)
    setDraft(String(next))
  }

  const isFree = value === ECONOMY.FREE_BET
  const fill = ((value - min) / (ECONOMY.MAX_BET - min)) * 100

  return (
    <div className="flex flex-col gap-3">
      {/* Ручной ввод числа — он же индикатор текущего значения */}
      <div className="flex items-center justify-center gap-3 min-h-12">
        {isFree ? (
          <span className={`font-black text-tg-green ${compact ? 'text-2xl' : 'text-3xl'}`}>
            {t('bet.free')}
          </span>
        ) : (
          <>
            <span className={compact ? 'text-2xl' : 'text-3xl'}>🪙</span>
            <input
              type="number"
              inputMode="numeric"
              value={draft}
              min={min}
              max={ECONOMY.MAX_BET}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={`bg-transparent text-tg-yellow font-black text-center outline-none ${compact ? 'text-3xl w-24' : 'text-4xl w-32'}`}
              aria-label={t('common.bet')}
            />
          </>
        )}
      </div>

      <input
        type="range"
        min={min}
        max={ECONOMY.MAX_BET}
        step={ECONOMY.BET_STEP}
        value={value}
        onChange={(e) => onChange(clampBet(Number(e.target.value)))}
        className="range-input w-full cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--tg-yellow) ${fill}%, var(--tg-fill-2) ${fill}%)`,
        }}
      />

      <div className="flex gap-2 flex-wrap justify-center">
        {allowFree && (
          <button
            onClick={() => {
              hapticSelection()
              onChange(ECONOMY.FREE_BET)
            }}
            className="tappable rounded-xl px-3 py-1.5 text-sm font-bold transition-all duration-150"
            style={{
              background: isFree ? 'var(--tg-green)' : 'var(--tg-fill)',
              color: isFree ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
            }}
          >
            {t('bet.free')}
          </button>
        )}
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

      {allowFree && isFree && (
        <p className="text-tg-subtext text-xs leading-relaxed text-center">{t('bet.free.note')}</p>
      )}
    </div>
  )
}

/** Выбор количества раундов. Только нечётные значения (правка 9). */
export function RoundsPicker({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {ECONOMY.ROUNDS_OPTIONS.map((n) => (
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
  )
}
