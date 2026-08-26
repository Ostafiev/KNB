import { useState } from 'react'
import { BottomSheet, SheetRow } from './BottomSheet'
import { TopBar } from './TopBar'
import { ProfileSheet } from '../sheets/ProfileSheet'
import { ReferralSheet } from '../sheets/ReferralSheet'
import { TopUpSheet } from '../sheets/TopUpSheet'
import { SupportSheet, FeedbackSheet, FAQSheet } from '../sheets/MiscSheets'
import { HistorySheet } from '../sheets/HistorySheet'
import { useT } from '../i18n'
import { ECONOMY } from '../config/economy'

type MenuSub = 'profile' | 'referral' | 'history' | 'support' | 'feedback' | 'faq' | null

/**
 * Главное меню приложения.
 *
 * Правка 15: пункт «Выйти из аккаунта» убран — в Telegram Mini App выходить
 * некуда, вход всегда через Telegram.
 */
export function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [sub, setSub] = useState<MenuSub>(null)

  const closeAll = () => {
    setSub(null)
    onClose()
  }

  return (
    <>
      <BottomSheet open={open && sub === null} onClose={onClose}>
        <SheetRow icon="👤" label={t('menu.profile')} sublabel={t('menu.profile.sub')} onClick={() => setSub('profile')} />
        <SheetRow
          icon="🎁"
          label={t('menu.referral')}
          sublabel={t('menu.referral.sub', { amount: ECONOMY.REFERRAL_INVITER_BONUS })}
          onClick={() => setSub('referral')}
        />
        <SheetRow
          icon="🧾"
          label={t('history.title')}
          sublabel={t('menu.history.sub')}
          onClick={() => setSub('history')}
        />
        <SheetRow icon="💛" label={t('menu.support')} sublabel={t('menu.support.sub')} onClick={() => setSub('support')} />
        <SheetRow icon="✉️" label={t('menu.feedback')} sublabel={t('menu.feedback.sub')} onClick={() => setSub('feedback')} />
        <SheetRow icon="❓" label={t('menu.faq')} sublabel={t('menu.faq.sub')} onClick={() => setSub('faq')} />
      </BottomSheet>

      {sub === 'profile' && <ProfileSheet onClose={closeAll} />}
      {sub === 'referral' && <ReferralSheet onClose={closeAll} />}
      {sub === 'history' && <HistorySheet onClose={closeAll} />}
      {sub === 'support' && <SupportSheet onClose={closeAll} />}
      {sub === 'feedback' && <FeedbackSheet onClose={closeAll} />}
      {sub === 'faq' && <FAQSheet onClose={closeAll} />}
    </>
  )
}

/**
 * Верхний бар + меню одним вызовом — чтобы каждый экран не повторял
 * одинаковый стейт. Возвращает готовые элементы для вставки в разметку.
 */
export function useAppChrome() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)
  return {
    topBar: <TopBar onMenu={() => setMenuOpen(true)} />,
    menu: (
      <>
        <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
        {topUpOpen && <TopUpSheet onClose={() => setTopUpOpen(false)} />}
      </>
    ),
    openTopUp: () => setTopUpOpen(true),
  }
}
