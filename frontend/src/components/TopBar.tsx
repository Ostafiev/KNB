import { useI18n, useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { formatCoins } from '../lib/format'

/**
 * Верхний бар приложения (правка 4): логотип, баланс медяков и кнопка меню.
 * Показывается на всех экранах, кроме заставки, экрана согласия и самого боя —
 * в бою полноэкранный игровой момент со своими иконками.
 *
 * Правка 16: в баре только цифра баланса; кнопка «Пополнить» живёт
 * в карточке баланса на главной, чтобы не дублироваться.
 */
export function TopBar({ onMenu, onHome }: { onMenu: () => void; onHome?: () => void }) {
  const t = useT()
  const { lang } = useI18n()
  const { balance } = useAppState()

  return (
    <div className="flex items-center justify-between pt-2 pb-1">
      {/* Логотип работает как кнопка «домой» — так его и пробуют нажать. */}
      {onHome ? (
        <button
          onClick={onHome}
          className="tappable text-xl font-black text-tg-text tracking-tight"
          aria-label={t('home.toHome')}
        >
          КНБ
        </button>
      ) : (
        <div className="text-xl font-black text-tg-text tracking-tight">КНБ</div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 glass rounded-full px-3 py-1.5">
          <span className="text-sm">🪙</span>
          <span className="text-sm font-bold text-tg-text font-mono">{formatCoins(balance, lang)}</span>
        </div>
        <button
          onClick={onMenu}
          className="tappable w-9 h-9 glass rounded-xl flex items-center justify-center border border-tg-border text-tg-subtext"
          aria-label={t('home.menu')}
        >
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <rect y="0" width="16" height="2" rx="1" fill="currentColor" />
            <rect y="5" width="12" height="2" rx="1" fill="currentColor" />
            <rect y="10" width="8" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  )
}
