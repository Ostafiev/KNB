import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { useT } from '../i18n'

/**
 * Подтверждение реванша вторым игроком.
 * TODO(backend): реальный pending-запрос через WebSocket (ЧАСТЬ 3, п.8) —
 * сейчас лист открывается по таймеру как демонстрация сценария.
 */
export function RematchConfirmSheet({
  opponentName,
  opponentAvatar,
  bet,
  rounds,
  condition,
  onAccept,
  onDecline,
  onEditConditions,
}: {
  opponentName: string
  opponentAvatar: string
  bet: number
  rounds: number
  condition: string
  onAccept: () => void
  onDecline: () => void
  onEditConditions: () => void
}) {
  const t = useT()

  return (
    <BottomSheet open onClose={onDecline}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-2xl glass-strong flex items-center justify-center text-2xl flex-shrink-0">
          {opponentAvatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-black text-tg-text">{t('summary.rematch.question')}</div>
          <div className="text-tg-subtext text-xs truncate">
            {t('summary.rematch.requests', { name: opponentName })}
          </div>
        </div>
        <div className="glass rounded-full px-2.5 py-1 flex items-center gap-1 flex-shrink-0">
          <span className="text-xs">🪙</span>
          <span className="text-sm font-black text-tg-yellow">{bet}</span>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 mb-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-xs uppercase tracking-wider">{t('common.bet')}</span>
          <span className="text-sm font-bold text-tg-text">{bet} 🪙</span>
        </div>
        <div className="h-px" style={{ background: 'var(--tg-border)' }} />
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-xs uppercase tracking-wider">{t('common.rounds')}</span>
          <span className="text-sm font-bold text-tg-text">{rounds}</span>
        </div>
        {condition.trim() && (
          <>
            <div className="h-px" style={{ background: 'var(--tg-border)' }} />
            <div className="flex items-start justify-between gap-3">
              <span className="text-tg-subtext text-xs uppercase tracking-wider flex-shrink-0">
                {t('summary.condition')}
              </span>
              <span className="text-sm text-tg-text text-right">"{condition}"</span>
            </div>
          </>
        )}
      </div>

      <button
        onClick={onEditConditions}
        className="tappable text-tg-blue-light text-xs font-semibold text-center w-full py-1.5 mb-1"
      >
        {t('summary.editConditions')}
      </button>

      <SheetDivider />

      <button
        onClick={onAccept}
        className="tappable w-full py-4 rounded-2xl font-bold text-base glow-green mb-1"
        style={{
          background: 'linear-gradient(135deg, var(--tg-green) 0%, var(--tg-green-dark) 100%)',
          color: 'var(--tg-on-accent)',
        }}
      >
        ✅ {t('common.accept')}
      </button>
      <button
        onClick={onDecline}
        className="tappable w-full py-3.5 rounded-2xl font-bold text-sm glass border border-tg-red/30 text-tg-red"
      >
        ✗ {t('common.decline')}
      </button>
    </BottomSheet>
  )
}
