import { useEffect, useState } from 'react'
import { PrimaryButton, GhostButton } from '../components/ui'
import { BetSlider, RoundsPicker } from '../components/BetControls'
import { RematchConfirmSheet } from '../sheets/RematchConfirmSheet'
import { useI18n, useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'
import { HAND_EMOJI } from '../lib/game'
import { formatCoins } from '../lib/format'
import { hapticNotify } from '../telegram/sdk'
import type { MatchConfig, Outcome, RoundResult } from '../types'

type RematchPhase = 'idle' | 'waiting' | 'editing' | 'opponent-confirm'

export function SummaryScreen({
  config,
  outcome,
  rounds,
  score,
  ratingDelta,
  onRematch,
  onMenu,
}: {
  config: MatchConfig
  outcome: Outcome
  rounds: RoundResult[]
  score: { player: number; opponent: number }
  ratingDelta: number
  onRematch: (config: MatchConfig) => void
  onMenu: () => void
}) {
  const t = useT()
  const { lang } = useI18n()
  const { nickname, avatar, balance, rewardAd } = useAppState()

  const [phase, setPhase] = useState<RematchPhase>('idle')
  const [rematchBet, setRematchBet] = useState(config.bet)
  const [rematchRounds, setRematchRounds] = useState(config.roundsTotal)
  const [rematchCondition, setRematchCondition] = useState(config.condition)
  const [waitDots, setWaitDots] = useState(0)
  const [adWatched, setAdWatched] = useState(false)
  const [adLoading, setAdLoading] = useState(false)

  const coinsDelta = outcome === 'win' ? config.bet : outcome === 'lose' ? -config.bet : 0
  const lastRound = rounds[rounds.length - 1]

  useEffect(() => {
    if (phase !== 'waiting') return
    const timer = setInterval(() => setWaitDots((d) => (d + 1) % 4), 500)
    return () => clearInterval(timer)
  }, [phase])

  // TODO(backend): ответ соперника приходит по WebSocket. Сейчас — демонстрация по таймеру.
  useEffect(() => {
    if (phase !== 'waiting') return
    const timer = setTimeout(() => setPhase('opponent-confirm'), 4000)
    return () => clearTimeout(timer)
  }, [phase])

  const acceptRematch = () => {
    setPhase('idle')
    onRematch({
      ...config,
      bet: rematchBet,
      roundsTotal: rematchRounds,
      condition: config.mode === 'friend' ? rematchCondition.trim() : '',
    })
  }

  const watchAd = () => {
    setAdLoading(true)
    // TODO(monetization): rewarded interstitial через SDK провайдера (AdsGram / HilltopAds / Monetag).
    // Начисление — только по колбэку успешного досмотра, подтверждённому сервером.
    setTimeout(() => {
      rewardAd()
      setAdLoading(false)
      setAdWatched(true)
      hapticNotify('success')
    }, 1200)
  }

  const outcomeLabel =
    outcome === 'win' ? t('summary.win') : outcome === 'lose' ? t('summary.lose') : t('summary.draw')
  const outcomeColor =
    outcome === 'win'
      ? 'text-tg-green text-glow-green'
      : outcome === 'lose'
        ? 'text-tg-red text-glow-red'
        : 'text-tg-yellow'

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-4 gap-4">
      <div className="text-center pt-4">
        <div className="text-tg-subtext text-xs uppercase tracking-widest mb-1">{t('summary.eyebrow')}</div>
        <h1 className="text-2xl font-black text-tg-text">{t('summary.title')}</h1>
      </div>

      {/* Табло: соперник слева, игрок справа */}
      <div className="glass rounded-3xl p-5 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10 rounded-3xl pointer-events-none"
          style={{
            background:
              outcome === 'win'
                ? 'linear-gradient(135deg, var(--tg-green), var(--tg-green-dark))'
                : outcome === 'lose'
                  ? 'linear-gradient(135deg, var(--tg-red), #7a1a1a)'
                  : 'linear-gradient(135deg, var(--tg-yellow), #7a6500)',
          }}
        />
        <div className="relative flex items-center justify-between">
          <div className="flex flex-col items-center gap-2 w-20">
            <div className="w-14 h-14 rounded-2xl glass-strong flex items-center justify-center text-3xl">
              {config.opponentAvatar}
            </div>
            <div className="text-xs text-tg-subtext truncate max-w-full">
              {config.opponentName.split(' ')[0]}
            </div>
            <div className="text-3xl">{lastRound ? HAND_EMOJI[lastRound.opponentChoice] : '✊'}</div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className={`text-2xl font-black ${outcomeColor}`}>{outcomeLabel}</div>
            <div className="text-3xl font-black font-mono text-tg-text">
              {score.opponent}:{score.player}
            </div>
            <div className="glass rounded-full px-3 py-1 flex items-center gap-1">
              <span className="text-sm">🪙</span>
              <span
                className={`font-black text-sm ${
                  coinsDelta > 0 ? 'text-tg-green' : coinsDelta < 0 ? 'text-tg-red' : 'text-tg-subtext'
                }`}
              >
                {coinsDelta > 0 ? '+' : ''}
                {coinsDelta}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 w-20">
            <div className="w-14 h-14 rounded-2xl glass-strong flex items-center justify-center text-3xl">
              {avatar}
            </div>
            <div className="text-xs text-tg-subtext truncate max-w-full">{nickname.split(' ')[0]}</div>
            <div className="text-3xl">{lastRound ? HAND_EMOJI[lastRound.playerChoice] : '✊'}</div>
          </div>
        </div>
      </div>

      {/* Раскладка по раундам */}
      {config.roundsTotal > 1 && rounds.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="text-tg-subtext text-xs uppercase tracking-wider mb-3">{t('summary.roundsRecap')}</div>
          <div className="flex flex-col gap-2">
            {rounds.map((round) => (
              <div key={round.round} className="flex items-center gap-3">
                <span className="text-tg-subtext text-xs font-mono w-4 flex-shrink-0">{round.round}</span>
                <span className="text-xl">{HAND_EMOJI[round.opponentChoice]}</span>
                <span className="text-tg-subtext text-xs">vs</span>
                <span className="text-xl">{HAND_EMOJI[round.playerChoice]}</span>
                <span
                  className={`ml-auto text-xs font-bold ${
                    round.outcome === 'win'
                      ? 'text-tg-green'
                      : round.outcome === 'lose'
                        ? 'text-tg-red'
                        : 'text-tg-subtext'
                  }`}
                >
                  {round.outcome === 'win' ? '+1' : round.outcome === 'lose' ? '−1' : '='}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Расчёт */}
      <div
        className="glass rounded-2xl p-4 flex items-center gap-4 border"
        style={{
          borderColor:
            outcome === 'win' ? 'var(--tg-green)' : outcome === 'lose' ? 'var(--tg-red)' : 'var(--tg-yellow)',
        }}
      >
        <span className="text-3xl flex-shrink-0">
          {outcome === 'win' ? '🎁' : outcome === 'lose' ? '💸' : '🤝'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-tg-subtext text-xs">
            {outcome === 'win' ? t('summary.earned') : outcome === 'lose' ? t('summary.lost') : t('summary.drawn')}
          </div>
          <div
            className={`text-xl font-black ${
              outcome === 'win' ? 'text-tg-green' : outcome === 'lose' ? 'text-tg-red' : 'text-tg-yellow'
            }`}
          >
            {coinsDelta > 0 ? '+' : ''}
            {coinsDelta} 🪙
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-tg-subtext text-xs">{t('summary.newBalance')}</div>
          <div className="font-bold text-tg-text">{formatCoins(balance, lang)} 🪙</div>
          <div
            className={`text-xs font-semibold ${ratingDelta >= 0 ? 'text-tg-green' : 'text-tg-red'}`}
          >
            {t('summary.ratingDelta')} {ratingDelta >= 0 ? '+' : ''}
            {ratingDelta}
          </div>
        </div>
      </div>

      {/*
        ЧАСТЬ 5 — rewarded interstitial на экране итогов.
        Полностью добровольно: принудительных показов между экранами нет.
      */}
      {!adWatched && (
        <button
          onClick={watchAd}
          disabled={adLoading}
          className="tappable glass rounded-2xl px-4 py-3 flex items-center gap-3 border border-tg-yellow/40"
        >
          <span className="text-2xl flex-shrink-0">🎬</span>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-bold text-tg-text">
              {adLoading ? t('ad.loading') : t('ad.watch', { amount: ECONOMY.AD_REWARD })}
            </div>
            <div className="text-tg-subtext text-xs">{t('ad.hint')}</div>
          </div>
        </button>
      )}
      {adWatched && (
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3 border border-tg-green/40 animate-fade-in">
          <span className="text-2xl">✅</span>
          <span className="text-sm font-bold text-tg-green">
            {t('ad.watched', { amount: ECONOMY.AD_REWARD })}
          </span>
        </div>
      )}

      {/* Редактор условий реванша */}
      {phase === 'editing' ? (
        <div className="flex flex-col gap-3 animate-slide-up mt-auto pb-2">
          <div className="glass rounded-2xl p-4">
            <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
              {t('create.stake')}
            </div>
            <BetSlider value={rematchBet} onChange={setRematchBet} compact />
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
              {t('create.rounds')}
            </div>
            <RoundsPicker
              value={rematchRounds}
              onChange={setRematchRounds}
              max={config.mode === 'friend' ? ECONOMY.MAX_ROUNDS_INVITE : 5}
            />
          </div>
          {/* Условие пари — только в матче с другом (ЧАСТЬ 2, п.11) */}
          {config.mode === 'friend' && (
            <div className="glass rounded-2xl p-4">
              <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-2">
                {t('summary.condition')}
              </div>
              <textarea
                value={rematchCondition}
                onChange={(e) => setRematchCondition(e.target.value.slice(0, 200))}
                placeholder={t('create.condition.placeholder')}
                rows={2}
                className="w-full bg-transparent text-tg-text text-sm outline-none resize-none placeholder:text-tg-subtext/50 leading-relaxed"
              />
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setPhase('idle')}
              className="tappable flex-1 py-3.5 rounded-2xl font-bold text-sm glass border border-tg-border text-tg-subtext"
            >
              {t('common.cancel')}
            </button>
            <div className="flex-[2]">
              <PrimaryButton onClick={() => setPhase('waiting')} className="py-3.5">
                {t('summary.sendRematch')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mt-auto pb-2">
          {phase === 'idle' && (
            <PrimaryButton onClick={() => setPhase('waiting')} className="py-4 text-lg">
              {t('summary.rematch')}
            </PrimaryButton>
          )}

          {phase === 'waiting' && (
            <div
              className="glass rounded-2xl p-4 flex flex-col gap-3 border border-tg-blue/20"
              style={{ boxShadow: '0 0 18px rgba(42,159,214,0.12)' }}
            >
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="absolute inset-0 rounded-xl bg-tg-blue/20 animate-pulse-ring" />
                  <div className="w-10 h-10 rounded-xl glass-strong flex items-center justify-center text-xl relative z-10">
                    {config.opponentAvatar}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-tg-text">
                    {t('summary.waitingConfirm')}
                    {'.'.repeat(waitDots)}
                  </div>
                  <div className="text-tg-subtext text-xs truncate">
                    {t('summary.from', { name: config.opponentName })}
                  </div>
                </div>
                <div className="glass rounded-lg px-2.5 py-1 flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs">🪙</span>
                  <span className="text-sm font-black text-tg-yellow">{rematchBet}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPhase('editing')}
                  className="tappable flex-1 py-2.5 rounded-xl text-xs font-semibold glass border border-tg-blue/30 text-tg-blue-light"
                >
                  {t('summary.editConditions')}
                </button>
                <button
                  onClick={() => setPhase('idle')}
                  className="tappable flex-1 py-2.5 rounded-xl text-xs font-semibold glass border border-tg-red/30 text-tg-red"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          <GhostButton onClick={onMenu} className="py-4 text-base">
            {t('summary.mainMenu')}
          </GhostButton>
        </div>
      )}

      {phase === 'opponent-confirm' && (
        <RematchConfirmSheet
          opponentName={config.opponentName}
          opponentAvatar={config.opponentAvatar}
          bet={rematchBet}
          rounds={rematchRounds}
          condition={config.mode === 'friend' ? rematchCondition : ''}
          onAccept={acceptRematch}
          onDecline={() => setPhase('idle')}
          onEditConditions={() => setPhase('editing')}
        />
      )}
    </div>
  )
}
