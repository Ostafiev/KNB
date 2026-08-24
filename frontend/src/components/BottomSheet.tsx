export function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'var(--tg-scrim)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        // [&>*]:flex-shrink-0 обязательно: без него flex-контейнер со скроллом
        // сжимает содержимое по высоте, и карточки внутри листа схлопываются.
        className="glass-strong rounded-t-3xl w-full max-w-sm p-5 flex flex-col gap-2 animate-slide-up safe-bottom max-h-[92vh] overflow-y-auto [&>*]:flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-2 flex-shrink-0" style={{ background: 'var(--tg-fill-3)' }} />
        {children}
      </div>
    </div>
  )
}

export function SheetRow({
  icon,
  label,
  sublabel,
  danger,
  onClick,
  right,
}: {
  icon: string
  label: string
  sublabel?: string
  danger?: boolean
  onClick?: () => void
  right?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`tappable glass rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left w-full ${danger ? 'border border-tg-red/20' : ''}`}
    >
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${danger ? 'text-tg-red' : 'text-tg-text'}`}>{label}</div>
        {sublabel && <div className="text-tg-subtext text-xs mt-0.5">{sublabel}</div>}
      </div>
      {right ?? <span className="text-tg-subtext text-sm">›</span>}
    </button>
  )
}

export function SheetDivider() {
  return <div className="h-px my-1 flex-shrink-0" style={{ background: 'var(--tg-border)' }} />
}
