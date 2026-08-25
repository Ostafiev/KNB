import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { useT } from '../i18n'
import { ECONOMY } from '../config/economy'

/**
 * Пополнение баланса (правка 7).
 *
 * Оба канала пополнения равноправны (ЧАСТЬ 5): звёзды Telegram и TON.
 * TODO(backend): звёзды — Telegram Payments API, invoice (этап 2);
 * TON — TON Connect и отслеживание входящей транзакции на казначейский
 * кошелёк (этап 3). Пока экран показывает курсы и помечает способы как скорые.
 */
export function TopUpSheet({ onClose }: { onClose: () => void }) {
  const t = useT()

  const methods = [
    {
      icon: '⭐',
      title: t('topup.stars'),
      sub: t('topup.stars.rate', { coins: ECONOMY.COINS_PER_STAR }),
    },
    {
      icon: '💎',
      title: t('topup.ton'),
      sub: t('topup.ton.rate', { coins: ECONOMY.COINS_PER_TON }),
    },
  ]

  return (
    <BottomSheet open onClose={onClose}>
      <div className="text-center mb-1">
        <div className="text-4xl mb-2">🪙</div>
        <div className="font-black text-tg-text text-base">{t('topup.title')}</div>
        <div className="text-tg-subtext text-xs mt-1 leading-relaxed">{t('topup.subtitle')}</div>
      </div>

      <SheetDivider />

      {methods.map((method) => (
        <button
          key={method.title}
          onClick={onClose}
          className="tappable glass rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left w-full"
        >
          <span className="text-2xl flex-shrink-0">{method.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-tg-text">{method.title}</div>
            <div className="text-tg-subtext text-xs">{method.sub}</div>
          </div>
          <span
            className="text-xs font-semibold rounded-full px-2 py-0.5 flex-shrink-0"
            style={{ background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }}
          >
            {t('topup.soon')}
          </span>
        </button>
      ))}

      <div className="glass rounded-2xl p-4 flex gap-3 items-start">
        <span className="text-lg flex-shrink-0">🔒</span>
        <p className="text-tg-subtext text-xs leading-relaxed">{t('topup.note')}</p>
      </div>
    </BottomSheet>
  )
}
