import { hapticSelection } from '../telegram/sdk'

/** Числовая плитка статистики. */
export function StatChip({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: 'blue' | 'green' | 'red' | 'yellow'
}) {
  const colors = {
    blue: 'text-tg-blue-light',
    green: 'text-tg-green',
    red: 'text-tg-red',
    yellow: 'text-tg-yellow',
  }
  return (
    <div className="glass rounded-xl px-2 py-3 flex flex-col items-center gap-0.5">
      <span className={`text-xl font-black ${colors[color]}`}>{value}</span>
      <span className="text-tg-subtext text-xs font-medium text-center leading-tight">{label}</span>
    </div>
  )
}

/** Переключатель-тумблер. */
export function Toggle({
  checked,
  onChange,
  accent = 'var(--tg-blue)',
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  accent?: string
  label?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        hapticSelection()
        onChange(!checked)
      }}
      className="tappable w-11 h-6 rounded-full transition-all duration-200 relative flex-shrink-0"
      style={{ background: checked ? accent : 'var(--tg-fill-3)' }}
    >
      <div
        className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200"
        style={{ left: checked ? 22 : 2, background: '#fff' }}
      />
    </button>
  )
}

/** Чип-фильтр с активным состоянием. */
export function Chip({
  active,
  onClick,
  children,
  accent = 'var(--tg-blue)',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  accent?: string
}) {
  return (
    <button
      onClick={() => {
        hapticSelection()
        onClick()
      }}
      className="tappable flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150"
      style={{
        background: active ? accent : 'var(--tg-fill)',
        color: active ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
        border: active ? `1px solid ${accent}` : '1px solid transparent',
      }}
    >
      {children}
    </button>
  )
}

/** Основная акцентная кнопка. */
export function PrimaryButton({
  onClick,
  children,
  variant = 'blue',
  disabled,
  className = '',
}: {
  onClick?: () => void
  children: React.ReactNode
  variant?: 'blue' | 'green'
  disabled?: boolean
  className?: string
}) {
  const gradient =
    variant === 'green'
      ? 'linear-gradient(135deg, var(--tg-green) 0%, var(--tg-green-dark) 100%)'
      : 'linear-gradient(135deg, var(--tg-blue) 0%, var(--tg-blue-dark) 100%)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`tappable w-full py-4 rounded-2xl font-bold text-base relative overflow-hidden flex items-center justify-center gap-2 ${variant === 'green' ? 'glow-green' : 'glow-blue'} ${className}`}
      style={{ background: gradient, color: 'var(--tg-on-accent)', opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </button>
  )
}

/**
 * Кнопка «отправить в Telegram» — на самом деле ссылка.
 *
 * Просить клиент показать список чатов через Bot API оказалось нельзя:
 * он молчал — ни окна, ни отказа. А обычную ссылку на t.me Telegram
 * перехватывает сам и показывает своё окно «Выберите чаты». Поэтому все
 * места, откуда игра расходится между людьми, ведут сюда: один способ,
 * который работает во всех клиентах и не зависит от версии.
 */
export function ShareButton({
  href,
  children,
  variant = 'blue',
  onShared,
  className = '',
}: {
  href: string
  children: React.ReactNode
  variant?: 'blue' | 'green' | 'ghost'
  /** Позвать после нажатия: свернуть экран, отметить попытку. */
  onShared?: () => void
  className?: string
}) {
  const gradient =
    variant === 'green'
      ? 'linear-gradient(135deg, var(--tg-green) 0%, var(--tg-green-dark) 100%)'
      : 'linear-gradient(135deg, var(--tg-blue) 0%, var(--tg-blue-dark) 100%)'

  return (
    <a
      href={href}
      onClick={() => {
        hapticSelection()
        onShared?.()
      }}
      className={
        variant === 'ghost'
          ? `tappable w-full py-3.5 rounded-2xl font-bold text-tg-text glass-strong border border-tg-blue/40 flex items-center justify-center gap-2 ${className}`
          : `tappable w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 ${variant === 'green' ? 'glow-green' : 'glow-blue'} ${className}`
      }
      style={
        variant === 'ghost'
          ? undefined
          : { background: gradient, color: 'var(--tg-on-accent)' }
      }
    >
      {children}
    </a>
  )
}

/** Вторичная кнопка на стеклянной подложке. */
export function GhostButton({
  onClick,
  children,
  tone = 'neutral',
  className = '',
}: {
  onClick?: () => void
  children: React.ReactNode
  tone?: 'neutral' | 'danger' | 'accent'
  className?: string
}) {
  const border =
    tone === 'danger' ? 'border-tg-red/40' : tone === 'accent' ? 'border-tg-blue/40' : 'border-tg-border'
  const text = tone === 'danger' ? 'text-tg-red' : tone === 'accent' ? 'text-tg-blue-light' : 'text-tg-text'
  return (
    <button
      onClick={onClick}
      className={`tappable w-full py-3.5 rounded-2xl font-bold text-sm glass border ${border} ${text} ${className}`}
    >
      {children}
    </button>
  )
}

/** Хедер внутреннего экрана с кнопкой «назад». */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string
  onBack?: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-3">
      {onBack && (
        <button
          onClick={onBack}
          className="tappable w-9 h-9 glass rounded-xl flex items-center justify-center text-tg-subtext text-lg"
          aria-label="Назад"
        >
          ‹
        </button>
      )}
      <h1 className="font-black text-lg text-tg-text flex-1 truncate">{title}</h1>
      {right}
    </div>
  )
}
