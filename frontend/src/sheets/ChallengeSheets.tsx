import { useEffect, useState } from 'react'
import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { PrimaryButton, GhostButton } from '../components/ui'
import { useT } from '../i18n'
import { avatarEmoji } from '../data/mock'
import { ECONOMY } from '../config/economy'
import { hapticNotify } from '../telegram/sdk'
import type { ChallengeView } from '../api/client'

/**
 * Окна вызова на бой.
 *
 * Вызов живёт минуту, поэтому обратный отсчёт виден обеим сторонам: и тому,
 * кого зовут, и тому, кто позвал. Иначе окно выглядело бы как ультиматум без
 * срока, а исчезновение — как сбой.
 *
 * Часы здесь только для глаз: срок вызова считает сервер. Подкрутить время
 * на телефоне и получить лишние секунды нельзя.
 */

function useCountdown(until: number): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)))

  useEffect(() => {
    const tick = (): void => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [until])

  return left
}

function stake(bet: number, freeLabel: string): string {
  return bet === ECONOMY.FREE_BET ? freeLabel : `${bet} 🪙`
}

/** «Тебя зовут на бой» — у того, кому вызов пришёл. */
export function IncomingChallengeSheet({
  challenge,
  onAccept,
  onDecline,
}: {
  challenge: ChallengeView
  onAccept: () => void
  onDecline: () => void
}) {
  const t = useT()
  const left = useCountdown(challenge.expiresAt)

  // Звук и вибрация: человек мог смотреть в другой экран.
  useEffect(() => {
    hapticNotify('warning')
  }, [challenge.matchId])

  return (
    <BottomSheet open onClose={onDecline}>
      <div className="flex flex-col items-center gap-1 py-1">
        <div className="w-16 h-16 rounded-3xl glass-strong flex items-center justify-center text-3xl">
          {avatarEmoji(challenge.from.avatarId)}
        </div>
        <div className="text-tg-text font-black text-lg mt-1">{challenge.from.nickname}</div>
        <div className="text-tg-subtext text-sm">{t('challenge.incoming.title')}</div>
      </div>

      <SheetDivider />

      <div className="glass rounded-2xl p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-sm">{t('invite.stake')}</span>
          <span className="text-tg-text font-bold">{stake(challenge.bet, t('bet.free'))}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-sm">{t('invite.rounds')}</span>
          <span className="text-tg-text font-bold">{challenge.rounds}</span>
        </div>
        {challenge.condition && (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-tg-subtext text-sm">{t('invite.condition')}</span>
            <span className="text-tg-text text-sm leading-snug">{challenge.condition}</span>
          </div>
        )}
      </div>

      <div className="text-center text-tg-subtext text-xs">
        {t('challenge.expiresIn', { seconds: left })}
      </div>

      <PrimaryButton variant="green" onClick={onAccept}>
        <span className="text-xl">⚔️</span>
        <span>{t('challenge.accept')}</span>
      </PrimaryButton>
      <GhostButton onClick={onDecline}>{t('challenge.decline')}</GhostButton>
    </BottomSheet>
  )
}

/** «Ждём ответа» — у того, кто позвал. Не перекрывает экран целиком. */
export function OutgoingChallengeBanner({
  challenge,
  onCancel,
}: {
  challenge: ChallengeView
  onCancel: () => void
}) {
  const t = useT()
  const left = useCountdown(challenge.expiresAt)

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 glass-strong rounded-2xl px-4 py-3 flex items-center gap-3 border border-tg-border animate-slide-up"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 16px)', width: 'min(92vw, 360px)' }}
    >
      <span className="text-2xl flex-shrink-0">{avatarEmoji(challenge.to.avatarId)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-tg-text text-sm font-bold truncate">
          {t('challenge.waiting', { name: challenge.to.nickname })}
        </div>
        <div className="text-tg-subtext text-xs">{t('challenge.expiresIn', { seconds: left })}</div>
      </div>
      <button
        onClick={onCancel}
        className="tappable rounded-xl px-3 py-2 text-xs font-bold flex-shrink-0"
        style={{ background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }}
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}
