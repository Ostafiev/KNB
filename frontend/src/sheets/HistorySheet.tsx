import { useEffect, useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { useI18n, useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { api, type TransactionView } from '../api/client'
import type { TranslationKey } from '../i18n'

/**
 * История операций по медякам.
 *
 * Список приходит с сервера и является выпиской из журнала: каждая строка —
 * реальная запись, по которой считается баланс. Ничего не досчитывается
 * на клиенте, поэтому спор «куда делись медяки» решается этим экраном.
 */

/**
 * Тип операции — в человеческую строку. Незнакомый тип не прячем:
 * лучше показать сырое имя, чем пустую строку.
 */
const TYPE_LABEL: Record<string, TranslationKey> = {
  signup_bonus: 'history.type.signup_bonus',
  daily_bonus: 'history.type.daily_bonus',
  referral_bonus: 'history.type.referral_bonus',
  referral_signup: 'history.type.referral_signup',
  ad_reward: 'history.type.ad_reward',
  bet_hold: 'history.type.bet_hold',
  bet_refund: 'history.type.bet_refund',
  match_win: 'history.type.match_win',
  topup_stars: 'history.type.topup_stars',
  topup_ton: 'history.type.topup_ton',
  withdrawal: 'history.type.withdrawal',
  withdrawal_fee: 'history.type.withdrawal_fee',
  admin_adjustment: 'history.type.admin_adjustment',
}

function formatDay(iso: string, lang: 'ru' | 'en'): string {
  const date = new Date(iso)
  return date.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function HistorySheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { lang } = useI18n()
  const { status } = useAppState()

  const [items, setItems] = useState<TransactionView[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (status !== 'online') {
      setItems([])
      return
    }
    let cancelled = false
    api
      .getTransactions(50)
      .then(({ transactions }) => {
        if (!cancelled) setItems(transactions)
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [status])

  return (
    <BottomSheet open onClose={onClose}>
      <div className="text-center mb-1">
        <div className="text-lg font-black text-tg-text">{t('history.title')}</div>
      </div>

      {items === null && (
        <div className="py-8 text-center text-tg-subtext text-sm">…</div>
      )}

      {items !== null && items.length === 0 && (
        <div className="py-8 text-center text-tg-subtext text-sm">
          {failed ? t('history.failed') : t('history.empty')}
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="glass rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-tg-text truncate">
                  {TYPE_LABEL[item.type] ? t(TYPE_LABEL[item.type]) : (item.comment ?? item.type)}
                </div>
                <div className="text-tg-subtext text-xs">{formatDay(item.createdAt, lang)}</div>
              </div>
              <div className="text-right">
                <div
                  className={`text-sm font-bold font-mono ${
                    item.amount > 0 ? 'text-tg-green' : 'text-tg-red'
                  }`}
                >
                  {item.amount > 0 ? '+' : ''}
                  {item.amount} 🪙
                </div>
                <div className="text-tg-subtext text-xs font-mono">{item.balanceAfter}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
