import { useMemo, useState } from 'react'
import { ScreenHeader, Chip } from '../components/ui'
import { useI18n, useT } from '../i18n'
import { OPPONENTS, FRIENDS } from '../data/mock'
import { ECONOMY } from '../config/economy'
import { formatCoins } from '../lib/format'
import { hapticSelection } from '../telegram/sdk'
import type { MatchConfig, Player, Tab } from '../types'

type BetFilter = 'all' | 'low' | 'mid' | 'high'
type RoundsFilter = 'all' | number
type SortBy = 'online' | 'stake' | 'rating' | 'rounds'

export function OpponentsScreen({
  onSelect,
  onBack,
}: {
  onSelect: (config: MatchConfig) => void
  onBack: () => void
}) {
  const t = useT()
  const { lang } = useI18n()
  const [tab, setTab] = useState<Tab>('random')
  const [betFilter, setBetFilter] = useState<BetFilter>('all')
  const [roundsFilter, setRoundsFilter] = useState<RoundsFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('online')
  const [skillOnly, setSkillOnly] = useState(false)
  const [query, setQuery] = useState('')

  const list = useMemo(() => {
    const base = tab === 'random' ? OPPONENTS : FRIENDS
    return base
      .filter((p) => {
        if (betFilter === 'low') return p.bet <= 50
        if (betFilter === 'mid') return p.bet > 50 && p.bet <= 200
        if (betFilter === 'high') return p.bet > 200
        return true
      })
      .filter((p) => roundsFilter === 'all' || p.rounds === roundsFilter)
      .filter((p) => !skillOnly || p.rating >= 1500)
      .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'stake') return b.bet - a.bet
        if (sortBy === 'rating') return b.rating - a.rating
        if (sortBy === 'rounds') return b.rounds - a.rounds
        return (b.online ? 1 : 0) - (a.online ? 1 : 0)
      })
  }, [tab, betFilter, roundsFilter, skillOnly, query, sortBy])

  const totalOnline =
    OPPONENTS.filter((o) => o.online).length + FRIENDS.filter((f) => f.online).length

  /**
   * ЧАСТЬ 2, п.11 — текстовое условие пари доступно только в игре с друзьями.
   * Во вкладке «Случайный бой» condition всегда пустой.
   */
  const startMatch = (player: Player) =>
    onSelect({
      mode: tab === 'friends' ? 'friend' : 'random',
      bet: player.bet,
      roundsTotal: player.rounds,
      condition: '',
      opponentName: player.name,
      opponentAvatar: player.avatar,
      opponentRating: player.rating,
    })

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
        <ScreenHeader
          title={t('opponents.title')}
          onBack={onBack}
          right={
            <div className="glass rounded-full px-2.5 py-1 text-xs text-tg-green font-semibold flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--tg-green)' }} />
              {totalOnline} {t('common.online')}
            </div>
          }
        />
      </div>

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

      {/* Фильтры */}
      <div className="px-4 mb-3 flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {betChips.map(({ key, label }) => (
            <Chip key={key} active={betFilter === key} onClick={() => setBetFilter(key)}>
              {label}
            </Chip>
          ))}
        </div>

        {/* Фильтр по количеству раундов */}
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          <Chip active={roundsFilter === 'all'} onClick={() => setRoundsFilter('all')}>
            {t('opponents.rounds.any')}
          </Chip>
          {ECONOMY.ROUNDS_OPTIONS.map((n) => (
            <Chip key={n} active={roundsFilter === n} onClick={() => setRoundsFilter(n)}>
              {t('opponents.rounds.n', { n })}
            </Chip>
          ))}
        </div>

        {/* Сортировка + фильтр по рейтингу */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 flex-1 overflow-x-auto">
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
          <button
            onClick={() => setSkillOnly((v) => !v)}
            className="tappable flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 flex-shrink-0"
            style={{
              background: skillOnly ? 'rgba(42, 202, 92, 0.18)' : 'var(--tg-fill)',
              color: skillOnly ? 'var(--tg-green)' : 'var(--tg-subtext)',
              border: skillOnly ? '1px solid var(--tg-green)' : '1px solid transparent',
            }}
          >
            <span>{skillOnly ? '✓' : ''}</span>
            <span>{t('opponents.skill')}</span>
          </button>
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

      {/* Список */}
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-2 pb-4">
        {list.length === 0 && (
          <div className="glass rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
            <span className="text-4xl">🔍</span>
            <div className="text-tg-text font-bold">{t('opponents.empty')}</div>
            <div className="text-tg-subtext text-sm">{t('opponents.empty.hint')}</div>
          </div>
        )}
        {list.map((player, i) => (
          <button
            key={player.id}
            onClick={() => startMatch(player)}
            className="tappable glass rounded-2xl p-4 flex items-center gap-3 text-left border border-tg-border animate-slide-up"
            style={{ animationDelay: `${i * 0.06}s` }}
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
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-tg-blue-light text-xs">⚡</span>
                <span className="text-tg-subtext text-xs">
                  {formatCoins(player.rating, lang)} {t('common.pts')}
                </span>
                <span className="text-tg-subtext text-xs">·</span>
                <span className="text-tg-subtext text-xs">
                  {player.rounds} {t('common.rounds')}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <div className="glass rounded-lg px-2.5 py-1 flex items-center gap-1">
                <span className="text-xs">🪙</span>
                <span className="text-sm font-bold text-tg-text">{player.bet}</span>
              </div>
              <span className="text-tg-subtext text-xs">{t('common.coins')}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
