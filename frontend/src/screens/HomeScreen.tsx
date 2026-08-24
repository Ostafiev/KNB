import { useState } from 'react'
import { BottomSheet, SheetRow, SheetDivider } from '../components/BottomSheet'
import { StatChip } from '../components/ui'
import { ProfileSheet } from '../sheets/ProfileSheet'
import { StatsSheet } from '../sheets/StatsSheet'
import { ReferralSheet } from '../sheets/ReferralSheet'
import { InviteSheet } from '../sheets/InviteSheet'
import { SupportSheet, FeedbackSheet, FAQSheet } from '../sheets/MiscSheets'
import { useI18n, useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'
import { rankFor } from '../lib/game'
import { formatCoins, formatRelative } from '../lib/format'
import { FRIENDS, RECENT_GAMES } from '../data/mock'
import { hapticNotify } from '../telegram/sdk'
import type { MatchConfig } from '../types'

type HomeSheet = 'menu' | 'profile' | 'support' | 'feedback' | 'faq' | 'stats' | 'referral' | 'invite' | null

export function HomeScreen({
  onOpponents,
  onCreate,
  onStartMatch,
}: {
  onOpponents: () => void
  onCreate: () => void
  onStartMatch: (config: MatchConfig) => void
}) {
  const t = useT()
  const { lang } = useI18n()
  const {
    nickname,
    avatar,
    balance,
    rating,
    stats,
    dailyBonusAvailable,
    claimDailyBonus,
  } = useAppState()

  const [sheet, setSheet] = useState<HomeSheet>(null)
  const [gamesExpanded, setGamesExpanded] = useState(false)

  const rank = rankFor(rating)
  const friendsOnline = FRIENDS.filter((f) => f.online).length
  const visibleGames = gamesExpanded ? RECENT_GAMES : RECENT_GAMES.slice(0, 3)

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-4 gap-4">
      {/*
        Хедер. В PROD это единственная навигация — DEV-бар со списком экранов
        рендерится только в dev-сборке (ЧАСТЬ 2, п.8).
      */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xl font-black text-tg-text tracking-tight">КНБ</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 glass rounded-full px-3 py-1.5">
            <span className="text-sm">🪙</span>
            <span className="text-sm font-bold text-tg-text font-mono">{formatCoins(balance, lang)}</span>
          </div>
          <button
            onClick={() => setSheet('menu')}
            className="tappable w-9 h-9 glass rounded-xl flex items-center justify-center border border-tg-border"
            aria-label={t('home.menu')}
          >
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
              <rect y="0" width="16" height="2" rx="1" fill="currentColor" className="text-tg-subtext" />
              <rect y="5" width="12" height="2" rx="1" fill="currentColor" className="text-tg-subtext" />
              <rect y="10" width="8" height="2" rx="1" fill="currentColor" className="text-tg-subtext" />
            </svg>
          </button>
        </div>
      </div>

      {/* Главное меню */}
      <BottomSheet open={sheet === 'menu'} onClose={() => setSheet(null)}>
        <SheetRow icon="👤" label={t('menu.profile')} sublabel={t('menu.profile.sub')} onClick={() => setSheet('profile')} />
        <SheetRow
          icon="🎁"
          label={t('menu.referral')}
          sublabel={t('menu.referral.sub', { amount: ECONOMY.REFERRAL_INVITER_BONUS })}
          onClick={() => setSheet('referral')}
        />
        <SheetRow icon="💛" label={t('menu.support')} sublabel={t('menu.support.sub')} onClick={() => setSheet('support')} />
        <SheetRow icon="✉️" label={t('menu.feedback')} sublabel={t('menu.feedback.sub')} onClick={() => setSheet('feedback')} />
        <SheetRow icon="❓" label={t('menu.faq')} sublabel={t('menu.faq.sub')} onClick={() => setSheet('faq')} />
        <SheetDivider />
        <SheetRow icon="🚪" label={t('menu.logout')} danger onClick={() => setSheet(null)} right={null} />
      </BottomSheet>

      {sheet === 'profile' && <ProfileSheet onClose={() => setSheet(null)} />}
      {sheet === 'support' && <SupportSheet onClose={() => setSheet(null)} />}
      {sheet === 'feedback' && <FeedbackSheet onClose={() => setSheet(null)} />}
      {sheet === 'faq' && <FAQSheet onClose={() => setSheet(null)} />}
      {sheet === 'stats' && <StatsSheet onClose={() => setSheet(null)} />}
      {sheet === 'referral' && <ReferralSheet onClose={() => setSheet(null)} />}
      {sheet === 'invite' && (
        <InviteSheet
          onClose={() => setSheet(null)}
          onInvite={(config) => {
            setSheet(null)
            onStartMatch(config)
          }}
        />
      )}

      {/* Карточка профиля */}
      <div className="glass rounded-3xl p-5 animate-slide-up relative overflow-hidden">
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

        <div className="grid grid-cols-4 gap-2 mt-4">
          <StatChip label={t('stats.games')} value={stats.games} color="blue" />
          <StatChip label={t('stats.wins')} value={stats.wins} color="green" />
          <StatChip label={t('stats.losses')} value={stats.losses} color="red" />
          <StatChip label={t('stats.draws')} value={stats.draws} color="yellow" />
        </div>

        {/* ЧАСТЬ 2, п.9 — «Показать статистику» */}
        <button
          onClick={() => setSheet('stats')}
          className="tappable w-full mt-3 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
          style={{ background: 'var(--tg-fill)', color: 'var(--tg-blue-light)' }}
        >
          <span>📊</span>
          <span>{t('home.showStats')}</span>
        </button>
      </div>

      {/* ЧАСТЬ 2, п.3 — ежедневный бонус */}
      <div
        className="glass rounded-2xl p-4 flex items-center gap-3 animate-slide-up"
        style={{
          animationDelay: '0.05s',
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

      {/* Баланс медяков */}
      <div className="glass rounded-2xl p-4 flex items-center gap-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>
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
        {/* TODO(backend): экран пополнения — звёзды (этап 2), TON Connect (этап 3) */}
        <button className="tappable glass rounded-xl px-3 py-2 text-sm font-semibold text-tg-blue-light border border-tg-blue/30 flex-shrink-0">
          {t('home.topUp')}
        </button>
      </div>

      {/* Три основных действия */}
      <div className="grid grid-cols-3 gap-2 animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <button
          onClick={onOpponents}
          className="tappable glass rounded-2xl p-3 flex flex-col gap-1.5 border border-tg-blue/30 glow-blue text-left"
        >
          <span className="text-2xl">⚔️</span>
          <span className="text-xs font-bold text-tg-text leading-tight">{t('home.findBattle')}</span>
          <span className="text-tg-subtext leading-tight" style={{ fontSize: 10 }}>{t('home.findBattle.sub')}</span>
        </button>
        <button
          onClick={onCreate}
          className="tappable glass rounded-2xl p-3 flex flex-col gap-1.5 border border-tg-green/30 glow-green text-left"
        >
          <span className="text-2xl">✏️</span>
          <span className="text-xs font-bold text-tg-text leading-tight">{t('home.createGame')}</span>
          <span className="text-tg-subtext leading-tight" style={{ fontSize: 10 }}>{t('home.createGame.sub')}</span>
        </button>
        {/* ЧАСТЬ 2, п.10 — «Позвать в игру» открывает поп-ап с условиями */}
        <button
          onClick={() => setSheet('invite')}
          className="tappable glass rounded-2xl p-3 flex flex-col gap-1.5 border border-tg-yellow/30 glow-yellow text-left"
        >
          <span className="text-2xl">🔗</span>
          <span className="text-xs font-bold text-tg-text leading-tight">{t('home.invite')}</span>
          <span className="text-tg-subtext leading-tight" style={{ fontSize: 10 }}>{t('home.invite.sub')}</span>
        </button>
      </div>

      {/* Друзья */}
      <button
        onClick={onOpponents}
        className="tappable glass rounded-2xl p-4 flex items-center gap-4 animate-slide-up border border-tg-border"
        style={{ animationDelay: '0.2s' }}
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

      {/* ЧАСТЬ 2, п.5 — аккордеон последних игр */}
      <div className="animate-slide-up pb-2" style={{ animationDelay: '0.25s' }}>
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
              {gamesExpanded ? t('home.collapse') : t('home.more', { count: RECENT_GAMES.length - 3 })}
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
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <span className="text-xl">{game.hand}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-tg-text truncate">{game.opp}</div>
                <div className="text-tg-subtext text-xs">{formatRelative(game.minutesAgo, lang)}</div>
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
