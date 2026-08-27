import { useState } from 'react'
import { BottomSheet, SheetDivider } from '../components/BottomSheet'
import { BetSlider, RoundsPicker } from '../components/BetControls'
import { PrimaryButton, GhostButton } from '../components/ui'
import { useT } from '../i18n'
import { FRIENDS } from '../data/mock'
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
  onInvite: (config: MatchConfig, options?: { share?: boolean }) => void
  onChallenge?: (config: MatchConfig & { opponentId: number }) => void
}) {
  const t = useT()
  const list = friends ?? FRIENDS
  const [friend, setFriend] = useState<Player | null>(presetFriend ?? list[0] ?? null)
  const [bet, setBet] = useState(100)
  const [rounds, setRounds] = useState(3)
  const [condition, setCondition] = useState('')

  const buildConfig = (opponent: Player | null): MatchConfig => ({
    mode: 'friend',
    bet,
    roundsTotal: rounds,
    condition: condition.trim(),
    opponentName: opponent?.name ?? '',
    opponentAvatar: opponent?.avatar ?? '👤',
    opponentRating: opponent?.rating ?? 1000,
  })

  /*
   * Отправка другу в Telegram. Матч заводится по-настоящему, и уже к нему
   * ведёт ссылка в сообщении: раньше здесь была ссылка со случайными
   * буквами, за которой не стояло никакого боя.
   */
  const sendToFriend = (): void => {
    /*
     * Соперника в приложении выбирать не обязательно: получателя человек
     * выберет в самом Telegram, из своего списка контактов. Раньше кнопка
     * была недоступна, пока друг не выбран, — и новый игрок, у которого
     * в игре ещё никого нет, не мог позвать вообще никого.
     */
    const target = presetFriend ??
      friend ?? { id: 0, name: '', avatar: '👤', rating: 0, bet, rounds, online: false }
    onInvite(buildConfig(target), { share: true })
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

      {/*
        Выбор друга — только когда соперник не задан заранее и есть из кого
        выбирать. Для отправки в Telegram он не нужен вовсе: получателя
        человек выберет в списке контактов, а пустая рамка «пока никого нет»
        над главной кнопкой выглядела бы как препятствие.
      */}
      {!presetFriend && list.length > 0 && (
        <>
          <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider">
            {t('invite.chooseFriend')}
            {variant === 'link' && (
              <span className="normal-case font-normal"> · {t('invite.chooseFriend.optional')}</span>
            )}
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

      {/*
        Вызов другу, который прямо сейчас в приложении, — самое быстрое:
        окно всплывёт у него через секунду. Во всех остальных случаях главное
        действие одно — отправить готовое сообщение в Telegram.
      */}
      {variant === 'challenge' ? (
        <>
          <PrimaryButton
            onClick={() => {
              const target = presetFriend ?? friend
              if (!target || !onChallenge) return
              onChallenge({ ...buildConfig(target), opponentId: target.id })
            }}
            disabled={!(presetFriend ?? friend)}
            className="mt-1"
          >
            <span className="text-xl">⚔️</span>
            <span>{t('challenge.send')}</span>
          </PrimaryButton>
          <GhostButton onClick={sendToFriend} tone="accent">
            📨 {t('invite.sendToFriend')}
          </GhostButton>
        </>
      ) : (
        <>
          <PrimaryButton onClick={sendToFriend} className="mt-1">
            <span className="text-xl">📨</span>
            <span>{t('invite.sendToFriend')}</span>
          </PrimaryButton>
          <GhostButton onClick={() => onInvite(buildConfig(presetFriend ?? friend ?? null))}>
            {t('invite.justLink')}
          </GhostButton>
        </>
      )}
    </BottomSheet>
  )
}
