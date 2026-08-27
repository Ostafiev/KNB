import { useState } from 'react'
import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { BetSlider, RoundsPicker } from '../components/BetControls'
import { PrimaryButton, GhostButton } from '../components/ui'
import { useT } from '../i18n'
import { FRIENDS } from '../data/mock'
import { BOT_USERNAME } from '../config/env'
import { ECONOMY } from '../config/economy'
import { shareLink } from '../telegram/sdk'
import type { MatchConfig, Player } from '../types'

/**
 * «Позвать в игру» — условия матча с другом: ставка, раунды, условие пари.
 *
 * Открывается двумя путями (правка 8): кнопкой на главном экране, где друга
 * ещё надо выбрать, и кнопкой «Позвать» на карточке друга — тогда `friend`
 * передан заранее и выбор не показывается.
 *
 * Ставка 0 здесь разрешена: бесплатная игра доступна только с друзьями
 * и по приглашению (правка 20).
 */
export function InviteSheet({
  friend: presetFriend,
  friends,
  variant = 'link',
  onClose,
  onInvite,
  onChallenge,
}: {
  friend?: Player
  /** Настоящий список друзей. Если не передан — демо-данные для превью. */
  friends?: Player[]
  /**
   * 'link' — отправить приглашение ссылкой, друг войдёт когда откроет.
   * 'challenge' — позвать прямо сейчас: друг в приложении и увидит окно.
   */
  variant?: 'link' | 'challenge'
  onClose: () => void
  onInvite: (config: MatchConfig) => void
  onChallenge?: (config: MatchConfig & { opponentId: number }) => void
}) {
  const t = useT()
  const list = friends ?? FRIENDS
  const [friend, setFriend] = useState<Player | null>(presetFriend ?? list[0] ?? null)
  const [bet, setBet] = useState(100)
  const [rounds, setRounds] = useState(3)
  const [condition, setCondition] = useState('')

  const buildConfig = (opponent: Player): MatchConfig => ({
    mode: 'friend',
    bet,
    roundsTotal: rounds,
    condition: condition.trim(),
    opponentName: opponent.name,
    opponentAvatar: opponent.avatar,
    opponentRating: opponent.rating,
  })

  const sendLink = () => {
    const url = `https://t.me/${BOT_USERNAME}?start=match_${Math.random().toString(36).slice(2, 10)}`
    const text = [
      `${t('invite.stake')}: ${bet === ECONOMY.FREE_BET ? t('bet.free') : `${bet} 🪙`}`,
      `${t('invite.rounds')}: ${rounds}`,
      condition.trim() ? `${t('invite.condition')}: ${condition.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    shareLink(url, text)
    onClose()
  }

  return (
    <BottomSheet open onClose={onClose}>
      <div className="mb-1">
        <div className="font-black text-tg-text">
          {variant === 'challenge' ? t('challenge.callTitle') : t('invite.title')}
        </div>
        <div className="text-tg-subtext text-xs mt-0.5">
          {presetFriend ? presetFriend.name : t('invite.subtitle')}
        </div>
      </div>

      <SheetDivider />

      {/* Выбор друга — только когда соперник не задан заранее */}
      {!presetFriend && (
        <>
          <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider">
            {t('invite.chooseFriend')}
          </div>
          {list.length === 0 ? (
            <div className="glass rounded-2xl p-5 flex flex-col items-center gap-1.5 text-center">
              <span className="text-2xl">👥</span>
              <div className="text-tg-text text-sm font-bold">{t('invite.noFriends')}</div>
              <div className="text-tg-subtext text-xs">{t('invite.noFriends.hint')}</div>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {list.map((f) => {
                const active = friend?.id === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setFriend(f)}
                    className="tappable flex-shrink-0 rounded-2xl px-3 py-2.5 flex flex-col items-center gap-1 w-20 transition-all duration-150"
                    style={{
                      background: active ? 'var(--tg-blue)' : 'var(--tg-fill)',
                      border: active ? '1px solid var(--tg-blue)' : '1px solid transparent',
                    }}
                  >
                    <div className="relative">
                      <span className="text-2xl">{f.avatar}</span>
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                        style={{
                          background: f.online ? 'var(--tg-green)' : 'var(--tg-subtext)',
                          borderColor: active ? 'var(--tg-blue)' : 'var(--tg-bg2)',
                        }}
                      />
                    </div>
                    <span
                      className="text-xs font-semibold truncate w-full text-center"
                      style={{ color: active ? 'var(--tg-on-accent)' : 'var(--tg-subtext)' }}
                    >
                      {f.name}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <SheetDivider />
        </>
      )}

      {/* Ставка — с вариантом «Бесплатно» */}
      <div className="glass rounded-2xl p-4">
        <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
          {t('invite.stake')}
        </div>
        <BetSlider value={bet} onChange={setBet} compact allowFree />
      </div>

      {/* Раунды */}
      <div className="glass rounded-2xl p-4">
        <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
          {t('invite.rounds')}
        </div>
        <RoundsPicker value={rounds} onChange={setRounds} />
      </div>

      {/* Условие пари */}
      <div className="glass rounded-2xl p-4">
        <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-2">
          {t('invite.condition')}
        </div>
        <textarea
          value={condition}
          onChange={(e) => setCondition(e.target.value.slice(0, 200))}
          placeholder={t('invite.condition.placeholder')}
          rows={2}
          className="w-full bg-transparent text-tg-text text-sm outline-none resize-none placeholder:text-tg-subtext/50 leading-relaxed"
        />
        {condition.length > 0 && (
          <div className="text-right text-tg-subtext text-xs mt-1">{condition.length}/200</div>
        )}
      </div>

      <PrimaryButton
        onClick={() => {
          if (!friend) return
          if (variant === 'challenge' && onChallenge) {
            onChallenge({ ...buildConfig(friend), opponentId: friend.id })
            return
          }
          onInvite(buildConfig(friend))
        }}
        disabled={!friend}
        className="mt-1"
      >
        <span className="text-xl">⚔️</span>
        <span>{variant === 'challenge' ? t('challenge.send') : t('invite.send')}</span>
      </PrimaryButton>
      <GhostButton onClick={sendLink} tone="accent">
        📨 {t('invite.sendLink')}
      </GhostButton>
    </BottomSheet>
  )
}
