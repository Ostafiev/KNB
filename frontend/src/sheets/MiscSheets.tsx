import { useState } from 'react'
import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { PrimaryButton, GhostButton } from '../components/ui'
import { useT, type TranslationKey } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'

// ─── Поддержать проект ────────────────────────────────────────────────────────

export function SupportSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  // TODO(backend): оплата звёздами через Telegram Payments API (ЧАСТЬ 3, этап 2).
  const tiers: { icon: string; label: TranslationKey; sub: TranslationKey; amount: string }[] = [
    { icon: '☕', label: 'support.coffee', sub: 'support.coffee.sub', amount: '50 🪙' },
    { icon: '🍕', label: 'support.pizza', sub: 'support.pizza.sub', amount: '200 🪙' },
    { icon: '🚀', label: 'support.fuel', sub: 'support.fuel.sub', amount: '500 🪙' },
  ]

  return (
    <BottomSheet open onClose={onClose}>
      <div className="text-center mb-1">
        <div className="text-4xl mb-2">💛</div>
        <div className="font-black text-tg-text text-base">{t('support.title')}</div>
        <div className="text-tg-subtext text-xs mt-1 leading-relaxed">{t('support.body')}</div>
      </div>
      <SheetDivider />
      {tiers.map(({ icon, label, sub, amount }) => (
        <button
          key={label}
          onClick={onClose}
          className="tappable glass rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left w-full"
        >
          <span className="text-xl">{icon}</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-tg-text">{t(label)}</div>
            <div className="text-tg-subtext text-xs">{t(sub)}</div>
          </div>
          <span className="text-tg-yellow font-bold text-sm">{amount}</span>
        </button>
      ))}
      <button
        onClick={onClose}
        className="tappable glass rounded-2xl px-4 py-3 text-center text-tg-subtext text-sm"
      >
        {t('support.later')}
      </button>
    </BottomSheet>
  )
}

// ─── Обратная связь ───────────────────────────────────────────────────────────

type FeedbackCategory = 'bug' | 'idea' | 'other'

export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  // Раньше этот useState жил внутри IIFE прямо в JSX — нарушение правил хуков.
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  const categories: { key: FeedbackCategory; label: TranslationKey }[] = [
    { key: 'bug', label: 'feedback.bug' },
    { key: 'idea', label: 'feedback.idea' },
    { key: 'other', label: 'feedback.other' },
  ]

  if (sent) {
    return (
      <BottomSheet open onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="text-5xl animate-scale-in">✅</div>
          <div className="font-black text-tg-text">{t('feedback.sent.title')}</div>
          <div className="text-tg-subtext text-sm text-center">{t('feedback.sent.body')}</div>
          <button
            onClick={onClose}
            className="tappable glass rounded-2xl px-6 py-3 text-sm font-semibold text-tg-text mt-1"
          >
            {t('common.close')}
          </button>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet open onClose={onClose}>
      <div className="font-black text-tg-text mb-1">{t('feedback.title')}</div>
      <div className="text-tg-subtext text-xs mb-3">{t('feedback.subtitle')}</div>

      <div className="flex gap-2 mb-3">
        {categories.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className="tappable rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150"
            style={{
              background: category === key ? 'var(--tg-blue)' : 'var(--tg-fill)',
              color: category === key ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div className="glass rounded-2xl p-3 mb-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          placeholder={t('feedback.placeholder')}
          rows={4}
          className="w-full bg-transparent text-tg-text text-sm outline-none resize-none placeholder:text-tg-subtext/50 leading-relaxed"
        />
        <div className="text-right text-tg-subtext text-xs mt-1">{text.length}/500</div>
      </div>

      {/* TODO(backend): POST /api/feedback { category, text } */}
      <PrimaryButton onClick={() => text.trim() && setSent(true)} disabled={!text.trim()}>
        {t('feedback.send')}
      </PrimaryButton>
    </BottomSheet>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQ_KEYS: { q: TranslationKey; a: TranslationKey }[] = [
  { q: 'faq.1.q', a: 'faq.1.a' },
  { q: 'faq.2.q', a: 'faq.2.a' },
  { q: 'faq.3.q', a: 'faq.3.a' },
  { q: 'faq.4.q', a: 'faq.4.a' },
  { q: 'faq.5.q', a: 'faq.5.a' },
  { q: 'faq.6.q', a: 'faq.6.a' },
]

export function FAQSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)

  const vars = {
    seconds: ECONOMY.ROUND_SECONDS,
    games: ECONOMY.WITHDRAW_MIN_GAMES,
    coins: ECONOMY.WITHDRAW_MIN_COINS,
  }

  return (
    <BottomSheet open onClose={onClose}>
      <div className="font-black text-tg-text mb-3">{t('faq.title')}</div>
      <div className="flex flex-col gap-2">
        {FAQ_KEYS.map(({ q, a }, i) => (
          <div key={q} className="glass rounded-2xl overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="tappable w-full px-4 py-3.5 flex items-start gap-3 text-left"
            >
              <span className="text-tg-blue-light text-sm mt-0.5 flex-shrink-0">Q</span>
              <span className="text-sm font-semibold text-tg-text flex-1">{t(q)}</span>
              <span
                className="text-tg-subtext text-xs flex-shrink-0 transition-transform duration-200 mt-0.5"
                style={{ display: 'inline-block', transform: open === i ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                ▾
              </span>
            </button>
            {open === i && (
              <div className="px-4 pb-3.5 animate-fade-in">
                <div className="h-px mb-2.5" style={{ background: 'var(--tg-border)' }} />
                <p className="text-tg-subtext text-sm leading-relaxed">{t(a, vars)}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}

// ─── Не хватает медяков ───────────────────────────────────────────────────────

/**
 * ЧАСТЬ 5 (реклама) — при попытке поставить больше, чем есть на балансе,
 * предлагаем посмотреть рекламу вместо того, чтобы блокировать действие.
 */
export function InsufficientBalanceSheet({
  needed,
  onClose,
}: {
  needed: number
  onClose: () => void
}) {
  const t = useT()
  const { balance, rewardAd } = useAppState()
  const [watching, setWatching] = useState(false)

  const watchAd = () => {
    setWatching(true)
    // TODO(monetization): вызов rewarded-рекламы через SDK провайдера;
    // начислять медяки только по колбэку успешного досмотра, подтверждённому сервером.
    setTimeout(() => {
      rewardAd()
      setWatching(false)
    }, 1200)
  }

  return (
    <BottomSheet open onClose={onClose}>
      <div className="text-center mb-1">
        <div className="text-4xl mb-2">🪙</div>
        <div className="font-black text-tg-text text-base">{t('ad.insufficient.title')}</div>
        <div className="text-tg-subtext text-xs mt-1 leading-relaxed">
          {t('ad.insufficient.body', { needed, balance })}
        </div>
      </div>
      <SheetDivider />
      <PrimaryButton onClick={watchAd} variant="green" disabled={watching}>
        <span className="text-xl">🎬</span>
        <span>{watching ? t('ad.loading') : t('ad.watch', { amount: ECONOMY.AD_REWARD })}</span>
      </PrimaryButton>
      {/* TODO(backend): экран пополнения — звёзды (этап 2) и TON Connect (этап 3) */}
      <GhostButton onClick={onClose} tone="accent">
        💳 {t('ad.insufficient.topUp')}
      </GhostButton>
      <div className="text-tg-subtext text-xs text-center mt-1">{t('ad.hint')}</div>
    </BottomSheet>
  )
}
