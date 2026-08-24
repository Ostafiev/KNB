import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { StatChip } from '../components/ui'
import { useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'

/**
 * ЧАСТЬ 2, п.9 — поп-ап статистики: игры, победы, поражения, ничьи.
 * Открывается кнопкой «Показать статистику» на главном экране.
 */
export function StatsSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { stats, rating, matchesToWithdraw, withdrawUnlocked } = useAppState()

  const winrate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0

  return (
    <BottomSheet open onClose={onClose}>
      <div className="text-center mb-1">
        <div className="text-3xl mb-1">📊</div>
        <div className="font-black text-tg-text text-base">{t('stats.title')}</div>
      </div>

      <SheetDivider />

      <div className="grid grid-cols-4 gap-2">
        <StatChip label={t('stats.games')} value={stats.games} color="blue" />
        <StatChip label={t('stats.wins')} value={stats.wins} color="green" />
        <StatChip label={t('stats.losses')} value={stats.losses} color="red" />
        <StatChip label={t('stats.draws')} value={stats.draws} color="yellow" />
      </div>

      {/* Полоса соотношения побед / ничьих / поражений */}
      <div className="glass rounded-2xl p-4 flex flex-col gap-2 mt-1">
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-xs uppercase tracking-wider">{t('stats.winrate')}</span>
          <span className="text-tg-green font-black text-sm">{winrate}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--tg-fill-2)' }}>
          <div style={{ width: `${(stats.wins / Math.max(1, stats.games)) * 100}%`, background: 'var(--tg-green)' }} />
          <div style={{ width: `${(stats.draws / Math.max(1, stats.games)) * 100}%`, background: 'var(--tg-yellow)' }} />
          <div style={{ width: `${(stats.losses / Math.max(1, stats.games)) * 100}%`, background: 'var(--tg-red)' }} />
        </div>
      </div>

      <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-xl">⚡</span>
        <span className="text-sm font-semibold text-tg-text flex-1">{t('stats.rating')}</span>
        <span className="text-tg-blue-light font-black">{rating.toLocaleString()}</span>
      </div>

      {/* Порог вывода из ЧАСТИ 5 — показываем прогресс, чтобы правило не было сюрпризом */}
      <div
        className="glass rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ border: `1px solid ${withdrawUnlocked ? 'var(--tg-green)' : 'var(--tg-border)'}` }}
      >
        <span className="text-xl">{withdrawUnlocked ? '🔓' : '🔒'}</span>
        <span className="text-sm font-medium text-tg-subtext flex-1 leading-snug">
          {withdrawUnlocked
            ? t('stats.withdrawUnlocked')
            : t('stats.toWithdraw', { count: matchesToWithdraw || ECONOMY.WITHDRAW_MIN_GAMES })}
        </span>
      </div>
    </BottomSheet>
  )
}
