import { useState } from 'react'
import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { PrimaryButton } from '../components/ui'
import { useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'
import { hapticNotify, shareLink } from '../telegram/sdk'

/**
 * ЧАСТЬ 2, п.3 — реферальный бонус.
 * Пригласивший +100 медяков (после первого матча друга), приглашённый +50 стартовых,
 * плюс ежедневный бонус 20/день.
 */
export function ReferralSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { referralLink, referral } = useAppState()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
      hapticNotify('success')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard недоступен — остаётся кнопка «Поделиться» */
    }
  }

  const steps = [
    { icon: '🔗', text: t('referral.step.1', { amount: ECONOMY.REFERRAL_INVITEE_BONUS }) },
    { icon: '⚔️', text: t('referral.step.2') },
    { icon: '🪙', text: t('referral.step.3', { amount: ECONOMY.REFERRAL_INVITER_BONUS }) },
  ]

  return (
    <BottomSheet open onClose={onClose}>
      <div className="text-center mb-1">
        <div className="text-4xl mb-2">🎁</div>
        <div className="font-black text-tg-text text-base">{t('referral.title')}</div>
        <div className="text-tg-subtext text-xs mt-1 leading-relaxed">{t('referral.subtitle')}</div>
      </div>

      <SheetDivider />

      {/* Как это работает — три шага */}
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <div key={i} className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
              style={{ background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }}
            >
              {i + 1}
            </span>
            <span className="text-lg flex-shrink-0">{step.icon}</span>
            <span className="text-sm text-tg-text leading-snug flex-1">{step.text}</span>
          </div>
        ))}
      </div>

      <div
        className="glass rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ border: '1px solid var(--tg-green)' }}
      >
        <span className="text-lg">📅</span>
        <span className="text-sm text-tg-text leading-snug">
          {t('referral.daily', { amount: ECONOMY.DAILY_BONUS })}
        </span>
      </div>

      <SheetDivider />

      {/* Счётчики */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass rounded-2xl p-3 flex flex-col items-center gap-0.5">
          <span className="text-xl font-black text-tg-blue-light">{referral.invited}</span>
          <span className="text-tg-subtext text-xs">{t('referral.invited')}</span>
        </div>
        <div className="glass rounded-2xl p-3 flex flex-col items-center gap-0.5">
          <span className="text-xl font-black text-tg-yellow">{referral.earned} 🪙</span>
          <span className="text-tg-subtext text-xs">{t('referral.earned')}</span>
        </div>
      </div>

      {referral.pending > 0 && (
        <div className="text-tg-subtext text-xs text-center">
          ⏳ {t('referral.pending', { count: referral.pending })}
        </div>
      )}

      {/* Ссылка */}
      <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-tg-subtext text-xs uppercase tracking-wider mb-0.5">{t('referral.yourLink')}</div>
          <div className="text-tg-text text-xs font-mono truncate">{referralLink}</div>
        </div>
        <button
          onClick={copy}
          className="tappable glass rounded-xl px-2.5 py-1.5 text-xs font-semibold text-tg-blue-light border border-tg-blue/30 flex-shrink-0"
        >
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>

      <PrimaryButton
        onClick={() => shareLink(referralLink, t('referral.subtitle'))}
        variant="green"
        className="mt-1"
      >
        <span className="text-xl">📨</span>
        <span>{t('referral.share')}</span>
      </PrimaryButton>
    </BottomSheet>
  )
}
