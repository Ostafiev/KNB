import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { PrimaryButton, GhostButton } from '../components/ui'
import { useT } from '../i18n'
import { avatarEmoji } from '../data/mock'
import { ECONOMY } from '../config/economy'
import type { InviteView } from '../api/client'

/**
 * «Друг принял твой вызов. Играем?»
 *
 * Появляется, когда человек возвращается в приложение и его уже ждут.
 * Раньше ради этого приходилось сидеть на экране ожидания и не выходить —
 * выход засчитывался поражением. Теперь ждать не нужно: приглашение живёт
 * сутки, а окно всплывает в удобный момент.
 *
 * «Позже» — не отказ. Приглашение остаётся, окно просто замолкает на час.
 */
export function InviteReadySheet({
  invite,
  iAmHost,
  onPlay,
  onLater,
}: {
  invite: InviteView
  iAmHost: boolean
  onPlay: () => void
  onLater: () => void
}) {
  const t = useT()
  const other = iAmHost ? invite.guest : invite.host
  const stake = invite.bet === ECONOMY.FREE_BET ? t('bet.free') : `${invite.bet} 🪙`

  return (
    <BottomSheet open onClose={onLater}>
      <div className="flex flex-col items-center gap-1 py-1">
        <div className="w-16 h-16 rounded-3xl glass-strong flex items-center justify-center text-3xl">
          {avatarEmoji(other?.avatarId ?? 'gamepad')}
        </div>
        <div className="text-tg-text font-black text-lg mt-1">{other?.nickname ?? ''}</div>
        <div className="text-tg-subtext text-sm text-center">
          {iAmHost ? t('invite.ready.guest') : t('invite.ready.host')}
        </div>
      </div>

      <SheetDivider />

      <div className="glass rounded-2xl p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-sm">{t('invite.stake')}</span>
          <span className="text-tg-text font-bold">{stake}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-tg-subtext text-sm">{t('invite.rounds')}</span>
          <span className="text-tg-text font-bold">{invite.rounds}</span>
        </div>
        {invite.condition && (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-tg-subtext text-sm">{t('invite.condition')}</span>
            <span className="text-tg-text text-sm leading-snug">{invite.condition}</span>
          </div>
        )}
      </div>

      <PrimaryButton variant="green" onClick={onPlay}>
        <span className="text-xl">⚔️</span>
        <span>{t('invite.ready.play')}</span>
      </PrimaryButton>
      <GhostButton onClick={onLater}>{t('invite.ready.later')}</GhostButton>
      <p className="text-center text-tg-subtext text-xs">{t('invite.ready.hint')}</p>
    </BottomSheet>
  )
}

/**
 * «Ждём друга» — тонкая полоска внизу, а не экран во весь рост.
 *
 * Смысл в том, чтобы человек продолжал пользоваться приложением: играл
 * с другими, смотрел профиль. Как только второй появится, бой начнётся сам.
 */
export function InviteWaitingBanner({
  invite,
  iAmHost,
  onCancel,
}: {
  invite: InviteView
  iAmHost: boolean
  onCancel: () => void
}) {
  const t = useT()
  const other = iAmHost ? invite.guest : invite.host

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 glass-strong rounded-2xl px-4 py-3 flex items-center gap-3 border border-tg-border animate-slide-up"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 16px)', width: 'min(92vw, 360px)' }}
    >
      <span className="text-2xl flex-shrink-0">{avatarEmoji(other?.avatarId ?? 'gamepad')}</span>
      <div className="flex-1 min-w-0">
        <div className="text-tg-text text-sm font-bold truncate">
          {other ? t('invite.waiting.title', { name: other.nickname }) : t('invite.waiting.anyone')}
        </div>
        <div className="text-tg-subtext text-xs">{t('invite.waiting.hint')}</div>
      </div>
      <button
        onClick={onCancel}
        className="tappable rounded-xl px-3 py-2 text-xs font-bold flex-shrink-0"
        style={{ background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }}
      >
        {t('common.close')}
      </button>
    </div>
  )
}
