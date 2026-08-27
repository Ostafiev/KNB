import { useMemo, useState } from 'react'
import { ScreenHeader, Chip } from '../components/ui'
import { useAppChrome } from '../components/AppMenu'
import { InviteSheet } from '../sheets/InviteSheet'
import { useI18n, useT } from '../i18n'
import { OPPONENTS, FRIENDS } from '../data/mock'
import { useOpenMatches } from '../state/useOpenMatches'
import { useFriends } from '../state/useFriends'
import { useLiveMatch } from '../state/LiveMatch'
import { avatarEmoji } from '../data/mock'
import { shareLink } from '../telegram/sdk'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'
import { formatCoins, formatRounds } from '../lib/format'
import { hapticSelection } from '../telegram/sdk'
import type { MatchConfig, Player, Tab } from '../types'

type BetFilter = 'all' | 'low' | 'mid' | 'high'
type RoundsFilter = 'all' | number
type SortBy = 'online' | 'stake' | 'rating' | 'rounds'

export function OpponentsScreen({
  initialTab,
  onSelect,
  onJoinOpen,
  onCreate,
  onBack,
}: {
  initialTab: Tab
  onSelect: (config: MatchConfig) => void
  /** Войти в конкретный открытый бой из списка. */
  onJoinOpen?: (matchId: number) => void
  /** Открыть создание боя — из пустого списка. */
  onCreate?: () => void
  onBack: () => void
}) {
  const t = useT()
  const { lang } = useI18n()
  const { topBar, menu } = useAppChrome()

  const [tab, setTab] = useState<Tab>(initialTab)
  const [betFilter, setBetFilter] = useState<BetFilter>('all')
  const [roundsFilter, setRoundsFilter] = useState<RoundsFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('online')
  const [query, setQuery] = useState('')
  const [inviteFriend, setInviteFriend] = useState<Player | null>(null)
  const [challengeFriend, setChallengeFriend] = useState<Player | null>(null)

  const open = useOpenMatches()
  const friends = useFriends()
  const live = useLiveMatch()
  const { referralLink } = useAppState()

  /*
   * Друзья с сервера — это люди, с которыми у игрока есть общая история.
   * Пока сервера нет (статичное превью), остаётся демо-список: иначе вкладка
   * выглядела бы сломанной.
   */
  const friendList = useMemo(
    () =>
      friends.friends
        .map((f) => ({
          ...f,
          player: {
            id: f.id,
            name: f.nickname,
            avatar: avatarEmoji(f.avatarId),
            rating: f.rating,
            bet: ECONOMY.BET_PRESETS[1] ?? ECONOMY.MIN_BET,
            rounds: 3,
            online: f.online,
          } satisfies Player,
        }))
        .filter((f) => f.nickname.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => Number(b.online) - Number(a.online)),
    [friends.friends, query],
  )

  const showRealFriends = tab === 'friends' && friends.live

  const list = useMemo(() => {
    /*
     * Во вкладке случайного боя показываем настоящие открытые бои с сервера.
     * Демо-список остаётся только там, где сервера нет вовсе — иначе экран
     * был бы пустым в статичном превью.
     */
    const base = tab === 'random' ? (open.live ? open.players : OPPONENTS) : FRIENDS
    return base
      .filter((p) => {
        if (betFilter === 'low') return p.bet <= 50
        if (betFilter === 'mid') return p.bet > 50 && p.bet <= 200
        if (betFilter === 'high') return p.bet > 200
        return true
      })
      .filter((p) => roundsFilter === 'all' || p.rounds === roundsFilter)
      .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'stake') return b.bet - a.bet
        if (sortBy === 'rating') return b.rating - a.rating
        if (sortBy === 'rounds') return b.rounds - a.rounds
        return (b.online ? 1 : 0) - (a.online ? 1 : 0)
      })
  }, [tab, betFilter, roundsFilter, query, sortBy, open.live, open.players])

  /**
   * Условие пари доступно только в игре с друзьями (ЧАСТЬ 2, п.11),
   * поэтому во вкладке «Случайный бой» condition всегда пустой.
   */
  const startMatch = (player: Player) => {
    // Настоящий открытый бой — входим именно в него, а не встаём в подбор.
    const matchId = (player as Player & { matchId?: number }).matchId
    if (tab === 'random' && open.live && matchId && onJoinOpen) {
      onJoinOpen(matchId)
      return
    }

    onSelect({
      mode: tab === 'friends' ? 'friend' : 'random',
      bet: player.bet,
      roundsTotal: player.rounds,
      condition: '',
      opponentName: player.name,
      opponentAvatar: player.avatar,
      opponentRating: player.rating,
    })
  }

  const betChips: { key: BetFilter; label: string }[] = [
    { key: 'all', label: t('opponents.bet.any') },
    { key: 'low', label: t('opponents.bet.low') },
    { key: 'mid', label: t('opponents.bet.mid') },
    { key: 'high', label: t('opponents.bet.high') },
  ]

  const sortChips: { key: SortBy; label: string }[] = [
    { key: 'online', label: t('opponents.sort.online') },
    { key: 'stake', label: t('opponents.sort.stake') },
    { key: 'rating', label: t('opponents.sort.rating') },
    { key: 'rounds', label: t('opponents.sort.rounds') },
  ]

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom">
      <div className="px-4">
        {topBar}
        {/* Правка 10: счётчик «N онлайн» из шапки убран */}
        <ScreenHeader title={t('opponents.title')} onBack={onBack} />
      </div>
      {menu}

      {inviteFriend && (
        <InviteSheet
          friend={inviteFriend}
          onClose={() => setInviteFriend(null)}
          onInvite={(config) => {
            setInviteFriend(null)
            onSelect(config)
          }}
        />
      )}

      {/*
        Условия боя с другом. Онлайн — вызываем прямо сейчас, оффлайн —
        остаётся ссылка: она внутри того же окна.
      */}
      {challengeFriend && (
        <InviteSheet
          friend={challengeFriend}
          friends={friendList.map((f) => f.player)}
          variant={challengeFriend.online ? 'challenge' : 'link'}
          onClose={() => setChallengeFriend(null)}
          onInvite={(config) => {
            setChallengeFriend(null)
            onSelect(config)
          }}
          onChallenge={(config) => {
            setChallengeFriend(null)
            live.challenge({
              toUserId: config.opponentId,
              bet: config.bet,
              rounds: config.roundsTotal,
              condition: config.condition || undefined,
            })
          }}
        />
      )}

      {/* Вкладки */}
      <div className="px-4 mb-3">
        <div className="glass rounded-2xl p-1 flex gap-1">
          {(['random', 'friends'] as Tab[]).map((key) => (
            <button
              key={key}
              onClick={() => {
                hapticSelection()
                setTab(key)
              }}
              className={`tappable flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${tab === key ? 'glow-blue' : ''}`}
              style={{
                background: tab === key ? 'var(--tg-blue)' : 'transparent',
                color: tab === key ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
              }}
            >
              {key === 'random' ? t('opponents.tab.random') : t('opponents.tab.friends')}
            </button>
          ))}
        </div>
      </div>

      {/* Фильтры — только для случайного боя: у друга ставка выбирается при вызове */}
      <div className={`px-4 mb-3 flex-col gap-2 ${showRealFriends ? 'hidden' : 'flex'}`}>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {betChips.map(({ key, label }) => (
            <Chip key={key} active={betFilter === key} onClick={() => setBetFilter(key)}>
              {label}
            </Chip>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-0.5">
          <Chip active={roundsFilter === 'all'} onClick={() => setRoundsFilter('all')}>
            {t('opponents.rounds.any')}
          </Chip>
          {ECONOMY.ROUNDS_OPTIONS.map((n) => (
            <Chip key={n} active={roundsFilter === n} onClick={() => setRoundsFilter(n)}>
              {n}
            </Chip>
          ))}
        </div>

        {/* Правка 11: непонятный фильтр «1500+ pts» убран */}
        <div className="flex gap-1.5 overflow-x-auto">
          {sortChips.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                hapticSelection()
                setSortBy(key)
              }}
              className="tappable flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150"
              style={{
                background: sortBy === key ? 'rgba(42,159,214,0.2)' : 'var(--tg-fill)',
                color: sortBy === key ? 'var(--tg-blue-light)' : 'var(--tg-subtext)',
              }}
            >
              {sortBy === key ? '↓ ' : ''}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Поиск */}
      <div className="px-4 mb-3">
        <div className="glass rounded-xl flex items-center gap-3 px-4 py-3">
          <span className="text-tg-subtext text-sm">🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('opponents.search')}
            className="flex-1 bg-transparent text-tg-text text-sm outline-none placeholder:text-tg-subtext/60"
          />
        </div>
      </div>

      {/* Друзья — настоящий список с сервера */}
      {showRealFriends && (
        <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-2 pb-4">
          {friendList.length === 0 && !friends.loading && (
            <div className="glass rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
              <span className="text-4xl">👥</span>
              <div className="text-tg-text font-bold">{t('friends.empty')}</div>
              <div className="text-tg-subtext text-sm leading-relaxed">
                {t('friends.empty.hint')}
              </div>
              <button
                onClick={() => shareLink(referralLink, t('referral.subtitle'))}
                className="tappable mt-1 rounded-xl px-4 py-2.5 text-sm font-bold"
                style={{ background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }}
              >
                {t('friends.empty.action')}
              </button>
            </div>
          )}

          {friendList.map((friend, i) => (
            <div
              key={friend.id}
              className="glass rounded-2xl p-3 flex items-center gap-3 border border-tg-border animate-slide-up"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div className="relative flex-shrink-0">
                <div className="w-12 h-12 rounded-2xl glass-strong flex items-center justify-center text-2xl">
                  {friend.player.avatar}
                </div>
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                  style={{
                    background: friend.online ? 'var(--tg-green)' : 'var(--tg-subtext)',
                    borderColor: 'var(--tg-bg)',
                  }}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-tg-text truncate">{friend.nickname}</div>
                <div className="text-tg-subtext text-xs truncate">
                  {friend.games > 0
                    ? t('friends.record', {
                        games: friend.games,
                        wins: friend.wins,
                        losses: friend.losses,
                      })
                    : t('friends.neverPlayed')}
                </div>
                {/*
                  Откуда человек в списке. Без этой подписи список выглядел бы
                  как чужие контакты, взявшиеся ниоткуда.
                */}
                <div className="text-tg-subtext/70 text-[11px] truncate mt-0.5">
                  {t(`friends.source.${friend.source}` as 'friends.source.played')}
                  {!friend.online && ` · ${t('friends.offline')}`}
                </div>
              </div>

              {/*
                Позвать прямо сейчас можно только того, кто у экрана: окно
                вызова живёт минуту и показать его некому. Остальным — ссылка.
              */}
              <button
                onClick={() => {
                  hapticSelection()
                  setChallengeFriend(friend.player)
                }}
                className="tappable rounded-xl px-3 py-2 text-xs font-bold flex-shrink-0"
                style={
                  friend.online
                    ? { background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }
                    : { background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }
                }
              >
                {friend.online ? t('challenge.call') : t('friends.inviteByLink')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Список открытых боёв */}
      <div className={`flex-1 overflow-y-auto px-4 flex-col gap-2 pb-4 ${showRealFriends ? 'hidden' : 'flex'}`}>
        {list.length === 0 && (
          <div className="glass rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
            <span className="text-4xl">🔍</span>
            <div className="text-tg-text font-bold">
              {tab === 'random' && open.live ? t('opponents.emptyOpen') : t('opponents.empty')}
            </div>
            <div className="text-tg-subtext text-sm">
              {tab === 'random' && open.live
                ? t('opponents.emptyOpen.hint')
                : t('opponents.empty.hint')}
            </div>
            {tab === 'random' && open.live && onCreate && (
              <button
                onClick={onCreate}
                className="tappable mt-1 rounded-xl px-4 py-2.5 text-sm font-bold"
                style={{ background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }}
              >
                {t('opponents.createOwn')}
              </button>
            )}
          </div>
        )}
        {list.map((player, i) => (
          <div
            key={player.id}
            className="glass rounded-2xl p-3 flex items-center gap-3 border border-tg-border animate-slide-up"
            style={{ animationDelay: `${i * 0.06}s` }}
          >
            <button
              onClick={() => startMatch(player)}
              className="tappable flex items-center gap-3 flex-1 min-w-0 text-left"
            >
              <div className="relative flex-shrink-0">
                <div className="w-12 h-12 rounded-2xl glass-strong flex items-center justify-center text-2xl">
                  {player.avatar}
                </div>
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                  style={{
                    background: player.online ? 'var(--tg-green)' : 'var(--tg-subtext)',
                    borderColor: 'var(--tg-bg)',
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-tg-text truncate">{player.name}</div>
                <div className="flex items-center gap-1 mt-0.5 whitespace-nowrap overflow-hidden">
                  <span className="text-tg-blue-light text-xs">⚡</span>
                  <span className="text-tg-subtext text-xs truncate">
                    {formatCoins(player.rating, lang)} · {formatRounds(player.rounds, lang)}
                  </span>
                </div>
              </div>
              <div className="glass rounded-lg px-2 py-1 flex items-center gap-1 flex-shrink-0">
                <span className="text-xs">🪙</span>
                <span className="text-sm font-bold text-tg-text">{player.bet}</span>
              </div>
            </button>

            {/*
              Правка 8: у каждого друга своя кнопка «Позвать» —
              открывает условия матча с уже выбранным соперником.
            */}
            {tab === 'friends' && (
              <button
                onClick={() => setInviteFriend(player)}
                className="tappable rounded-xl px-3 py-2 text-xs font-bold flex-shrink-0"
                style={{ background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }}
              >
                {t('opponents.invite')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
