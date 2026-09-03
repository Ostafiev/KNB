import { useEffect, useMemo, useState } from 'react'
import { StatChip } from '../components/ui'
import { useAppChrome } from '../components/AppMenu'
import { InviteSheet } from '../sheets/InviteSheet'
import { useI18n, useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'
import { rankFor } from '../lib/game'
import { formatCoins, formatRelative, formatRounds } from '../lib/format'
import { FRIENDS, avatarEmoji } from '../data/mock'
import { useFriends } from '../state/useFriends'
import { useRecentGames } from '../state/useRecentGames'
import { useMyInvites } from '../state/useMyInvites'
import type { InviteView } from '../api/client'
import { hapticNotify } from '../telegram/sdk'
import type { MatchConfig, Tab } from '../types'

/**
 * Сколько приглашению осталось жить.
 *
 * Точное время до минуты здесь не нужно и даже вредно: это не таймер, а
 * напоминание, что вызов не вечный. «Меньше часа» тревожит ровно настолько,
 * насколько нужно, чтобы человек вернулся к нему сегодня.
 */
function expiresIn(expiresAt: number | null, t: ReturnType<typeof useT>): string {
  if (!expiresAt) return ''
  const left = expiresAt - Date.now()
  if (left <= 0) return t('home.waitingInvites.expired')
  const hours = Math.floor(left / 3_600_000)
  return hours >= 1
    ? t('home.waitingInvites.hoursLeft', { hours })
    : t('home.waitingInvites.soon')
}


/**
 * Появление блоков — только при первом заходе.
 *
 * Каждый блок главной выезжает со своей задержкой: 0.05с, 0.1с, 0.15с…
 * В первый раз это выглядит живо. Но экран пересобирается при каждом
 * возвращении с боя, и тогда та же анимация читается как рывки подгрузки —
 * будто данные приходят по кускам. Второй раз человеку показывать нечего:
 * он и так знает, что здесь лежит.
 */
let homeShownOnce = false

export function HomeScreen({
  onOpponents,
  onCreate,
  onStartMatch,
  onResumeInvite,
}: {
  onOpponents: (tab: Tab) => void
  onCreate: () => void
  onStartMatch: (config: MatchConfig, options?: { share?: boolean }) => void
  /** Вернуться к свёрнутому приглашению. */
  onResumeInvite: (invite: InviteView) => void
}) {
  const t = useT()
  const { lang } = useI18n()
  const { topBar, menu } = useAppChrome()
  const {
    nickname,
    avatar,
    balance,
    rating,
    stats,
    matchesToWithdraw,
    withdrawUnlocked,
    dailyBonusAvailable,
    claimDailyBonus,
  } = useAppState()

  const [statsOpen, setStatsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [gamesExpanded, setGamesExpanded] = useState(false)

  const rank = rankFor(rating)
  // Друзья настоящие: те, с кем есть общая история в игре.
  const { friends, live: friendsLive } = useFriends()
  const friendList = useMemo(
    () =>
      friends.map((f) => ({
        id: f.id,
        name: f.nickname,
        avatar: avatarEmoji(f.avatarId),
        rating: f.rating,
        bet: ECONOMY.BET_PRESETS[1] ?? ECONOMY.MIN_BET,
        rounds: 3,
        online: f.online,
      })),
    [friends],
  )
  const friendsOnline = friendsLive
    ? friendList.filter((f) => f.online).length
    : FRIENDS.filter((f) => f.online).length
  const { games: recentGames } = useRecentGames()
  // Свои приглашения, которые ещё ждут друга.
  const { invites: myInvites } = useMyInvites()
  const visibleGames = gamesExpanded ? recentGames : recentGames.slice(0, 3)
  const winrate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0

  const [animate] = useState(!homeShownOnce)
  useEffect(() => {
    homeShownOnce = true
  }, [])
  /** Класс появления — пустой при возвращении на экран. */
  const enter = animate ? 'animate-slide-up' : ''
  /** Задержка появления нужна только вместе с анимацией. */
  const delay = (seconds: string): string | undefined => (animate ? seconds : undefined)

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-4 gap-4">
      {topBar}
      {menu}

      {inviteOpen && (
        <InviteSheet
          friends={friendsLive ? friendList : undefined}
          onClose={() => setInviteOpen(false)}
          onInvite={(config, options) => {
            setInviteOpen(false)
            onStartMatch(config, options)
          }}
        />
      )}

      {/* Карточка профиля */}
      <div className={`glass rounded-3xl p-5 relative overflow-hidden ${enter}`}>
        <div
          className="absolute inset-0 opacity-10 rounded-3xl pointer-events-none"
          style={{ background: 'linear-gradient(135deg, var(--tg-blue) 0%, var(--tg-green) 100%)' }}
        />
        <div className="relative flex items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl glass-strong flex items-center justify-center text-4xl glow-blue">
              {avatar}
            </div>
            <div
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2"
              style={{ background: 'var(--tg-green)', borderColor: 'var(--tg-bg)' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-tg-text truncate">{nickname}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-tg-blue-light text-sm">⚡</span>
              <span className="text-tg-subtext text-sm font-medium">{t('common.rating')}</span>
              <span className="text-tg-blue-light font-bold text-sm ml-auto">{formatCoins(rating, lang)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--tg-fill-2)' }}>
              <div
                className="h-full rounded-full animate-gradient"
                style={{
                  width: `${Math.round(rank.progress * 100)}%`,
                  background: 'linear-gradient(90deg, var(--tg-blue), var(--tg-green))',
                }}
              />
            </div>
            <div className="text-tg-subtext text-xs mt-0.5 truncate">
              {t('home.rankProgress', { rank: t(rank.key), points: rank.toNext })}
            </div>
          </div>
        </div>

        {/*
          Правка 18: постоянных плиток со статистикой больше нет.
          Кнопка раскрывает список показателей прямо здесь — без отдельного окна.
        */}
        <button
          onClick={() => setStatsOpen((v) => !v)}
          aria-expanded={statsOpen}
          className="relative tappable w-full mt-4 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
          style={{ background: 'var(--tg-fill)', color: 'var(--tg-blue-light)' }}
        >
          <span>📊</span>
          <span>{statsOpen ? t('home.hideStats') : t('home.showStats')}</span>
          <span
            className="transition-transform duration-200"
            style={{ display: 'inline-block', transform: statsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            ▾
          </span>
        </button>

        {statsOpen && (
          <div className="relative flex flex-col gap-2 mt-3 animate-fade-in">
            <div className="grid grid-cols-4 gap-2">
              <StatChip label={t('stats.games')} value={stats.games} color="blue" />
              <StatChip label={t('stats.wins')} value={stats.wins} color="green" />
              <StatChip label={t('stats.losses')} value={stats.losses} color="red" />
              <StatChip label={t('stats.draws')} value={stats.draws} color="yellow" />
            </div>

            <div className="glass rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-tg-subtext text-xs uppercase tracking-wider">{t('stats.winrate')}</span>
                <span className="text-tg-green font-black text-sm">{winrate}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--tg-fill-2)' }}>
                <div style={{ width: `${(stats.wins / Math.max(1, stats.games)) * 100}%`, background: 'var(--tg-green)' }} />
                <div style={{ width: `${(stats.draws / Math.max(1, stats.games)) * 100}%`, background: 'var(--tg-yellow)' }} />
                <div style={{ width: `${(stats.losses / Math.max(1, stats.games)) * 100}%`, background: 'var(--tg-red)' }} />
              </div>
            </div>

            <div
              className="glass rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ border: `1px solid ${withdrawUnlocked ? 'var(--tg-green)' : 'var(--tg-border)'}` }}
            >
              <span className="text-lg">{withdrawUnlocked ? '🔓' : '🔒'}</span>
              <span className="text-xs font-medium text-tg-subtext leading-snug">
                {withdrawUnlocked
                  ? t('stats.withdrawUnlocked')
                  : t('stats.toWithdraw', { count: matchesToWithdraw || ECONOMY.WITHDRAW_MIN_GAMES })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/*
        Играть — одно большое действие, а не три равных.
        Раньше «Найти бой», «Создать игру» и «Позвать друга» были одинаковыми
        плитками, и глазу не за что было зацепиться. Теперь главный путь —
        крупная кнопка, а два остальных остаются рядом, но потише.
      */}
      <div className={`flex flex-col gap-2 ${enter}`} style={{ animationDelay: delay('0.05s') }}>
        <button
          onClick={() => onOpponents('random')}
          className="tappable w-full rounded-2xl py-4 flex items-center justify-center gap-3 font-black text-lg glow-blue"
          style={{
            background: 'linear-gradient(135deg, var(--tg-blue) 0%, var(--tg-blue-dark) 100%)',
            color: 'var(--tg-on-accent)',
          }}
        >
          <span className="text-2xl">⚔️</span>
          <span>{t('home.play')}</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCreate}
            className="tappable glass rounded-2xl px-3 py-3 flex items-center gap-2.5 border border-tg-border text-left"
          >
            <span className="text-xl flex-shrink-0">✏️</span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-tg-text leading-tight truncate">
                {t('home.createGame')}
              </span>
              <span className="block text-tg-subtext leading-tight truncate" style={{ fontSize: 11 }}>
                {t('home.createGame.sub')}
              </span>
            </span>
          </button>
          <button
            onClick={() => setInviteOpen(true)}
            className="tappable glass rounded-2xl px-3 py-3 flex items-center gap-2.5 border border-tg-border text-left"
          >
            <span className="text-xl flex-shrink-0">🔗</span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-tg-text leading-tight truncate">
                {t('home.invite')}
              </span>
              <span className="block text-tg-subtext leading-tight truncate" style={{ fontSize: 11 }}>
                {t('home.invite.sub')}
              </span>
            </span>
          </button>
        </div>
      </div>

      {/*
        Бои, которые ждут друга.
        ────────────────────────
        Ожидание можно свернуть и заниматься чем угодно: приглашение живёт
        сутки. Но свёрнутое и невидимое — почти потерянное. Человек не помнит,
        кого позвал и на каких условиях, и либо зовёт заново, либо бросает.

        Поэтому блок появляется сам, как только есть чего ждать, и исчезает,
        когда ждать нечего — без пустого состояния и объяснений.
      */}
      {myInvites.length > 0 && (
        <div className={`flex flex-col gap-2 ${enter}`} style={{ animationDelay: delay('0.08s') }}>
          <div className="flex items-center gap-2 px-1">
            <span className="text-tg-subtext text-xs font-semibold uppercase tracking-wider">
              {t('home.waitingInvites')}
            </span>
            <span
              className="text-[11px] font-bold rounded-full px-1.5"
              style={{ background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }}
            >
              {myInvites.length}
            </span>
          </div>

          {myInvites.map((invite) => (
            <button
              key={invite.matchId}
              onClick={() => onResumeInvite(invite)}
              className="tappable glass rounded-2xl px-4 py-3 flex items-center gap-3 border text-left"
              style={{
                borderColor: invite.guestReady ? 'var(--tg-green)' : 'var(--tg-border)',
              }}
            >
              <span className="text-xl flex-shrink-0">{invite.guestReady ? '🔔' : '⏳'}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-tg-text truncate">
                  {/*
                    Условие пари — единственное, чем один вызов отличается от
                    другого в глазах человека. Оно и стоит первым.
                  */}
                  {invite.condition?.trim() ||
                    (invite.guest
                      ? t('home.waitingInvites.accepted', { name: invite.guest.nickname })
                      : t('home.waitingInvites.noCondition'))}
                </span>
                <span className="block text-tg-subtext text-xs truncate">
                  {invite.bet === ECONOMY.FREE_BET ? t('bet.free') : `${invite.bet} 🪙`} ·{' '}
                  {formatRounds(invite.rounds, lang)} · {expiresIn(invite.expiresAt, t)}
                </span>
              </span>
              <span
                className="text-xs font-bold flex-shrink-0"
                style={{ color: invite.guestReady ? 'var(--tg-green)' : 'var(--tg-blue-light)' }}
              >
                {invite.guestReady ? t('home.waitingInvites.play') : t('home.waitingInvites.open')}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Ежедневный бонус */}
      <div
        className={`glass rounded-2xl p-4 flex items-center gap-3 ${enter}`}
        style={{
          animationDelay: delay('0.1s'),
          border: dailyBonusAvailable ? '1px solid var(--tg-green)' : '1px solid var(--tg-border)',
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ background: 'rgba(42, 202, 92, 0.15)' }}
        >
          🎁
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-tg-text">{t('home.dailyBonus.title')}</div>
          <div className="text-tg-subtext text-xs">
            {dailyBonusAvailable
              ? t('home.dailyBonus.available', { amount: ECONOMY.DAILY_BONUS })
              : t('home.dailyBonus.next')}
          </div>
        </div>
        <button
          onClick={() => {
            if (!dailyBonusAvailable) return
            claimDailyBonus()
            hapticNotify('success')
          }}
          disabled={!dailyBonusAvailable}
          className="tappable rounded-xl px-3 py-2 text-sm font-bold flex-shrink-0"
          style={{
            background: dailyBonusAvailable ? 'var(--tg-green)' : 'var(--tg-fill)',
            color: dailyBonusAvailable ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
          }}
        >
          {dailyBonusAvailable ? t('home.dailyBonus.claim') : '✓'}
        </button>
      </div>

      {/* Баланс медяков. Правка 16: «Пополнить» живёт только здесь, не в баре */}
      <div className={`glass rounded-2xl p-4 flex items-center gap-4 ${enter}`} style={{ animationDelay: delay('0.15s') }}>
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ background: 'rgba(255, 214, 10, 0.15)' }}
        >
          🪙
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-tg-subtext text-xs font-medium uppercase tracking-wider">{t('home.balance')}</div>
          <div className="text-2xl font-black text-tg-yellow">{formatCoins(balance, lang)} 🪙</div>
        </div>
        {/*
          Кнопка «Пополнить» убрана: за ней пока ничего нет, а кнопка,
          которая никуда не ведёт, хуже её отсутствия. Вернётся вместе
          с рекламой и покупкой за Stars.
        */}
      </div>

      {/* Правка 5: открываем сразу вкладку «Друзья» */}
      <button
        onClick={() => onOpponents('friends')}
        className={`tappable glass rounded-2xl p-4 flex items-center gap-4 border border-tg-border ${enter}`}
        style={{ animationDelay: delay('0.2s') }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: 'rgba(42, 159, 214, 0.15)' }}
        >
          👥
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-bold text-tg-text">{t('home.friends')}</div>
          <div className="text-tg-subtext text-xs">{t('home.friends.online', { count: friendsOnline })}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }}
          >
            {friendsOnline}
          </div>
          <span className="text-tg-subtext text-sm">›</span>
        </div>
      </button>

      {/* Аккордеон последних игр. Пока матчей нет, блок не показываем вовсе:
          пустой заголовок выглядел бы поломкой. */}
      <div
        className={`pb-2 ${enter}`}
        style={{ animationDelay: delay('0.25s'), display: recentGames.length === 0 ? 'none' : undefined }}
      >
        <button
          onClick={() => setGamesExpanded((v) => !v)}
          className="tappable w-full flex items-center justify-between mb-2 px-1"
          aria-expanded={gamesExpanded}
        >
          <span className="text-tg-subtext text-xs font-semibold uppercase tracking-widest">
            {t('home.recentGames')}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-tg-subtext text-xs">
              {gamesExpanded
                ? t('home.collapse')
                : recentGames.length > 3
                  ? t('home.more', { count: recentGames.length - 3 })
                  : ''}
            </span>
            <span
              className="text-tg-subtext text-xs transition-transform duration-200"
              style={{ display: 'inline-block', transform: gamesExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              ▾
            </span>
          </div>
        </button>
        <div className="flex flex-col gap-2">
          {visibleGames.map((game, i) => (
            <div
              key={`${game.opp}-${game.minutesAgo}`}
              className="glass rounded-xl px-4 py-3 flex items-center gap-3 animate-fade-in"
              style={{ animationDelay: delay(`${i * 0.04}s`) }}
            >
              <span className="text-xl">{game.hand}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-tg-text truncate">{game.opp}</div>
                {/* Правка 6: количество раундов в карточке матча */}
                <div className="text-tg-subtext text-xs">
                  {formatRelative(game.minutesAgo, lang)} · {formatRounds(game.rounds, lang)}
                </div>
              </div>
              <span
                className={`text-sm font-bold font-mono ${
                  game.result === 'win'
                    ? 'text-tg-green'
                    : game.result === 'lose'
                      ? 'text-tg-red'
                      : 'text-tg-subtext'
                }`}
              >
                {game.delta > 0 ? '+' : ''}
                {game.delta} 🪙
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
