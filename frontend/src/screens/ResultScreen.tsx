import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { PrimaryButton } from '../components/ui'
import { Hand } from '../components/Hand'
import type { MatchConfig, Outcome, RoundResult } from '../types'

/**
 * Результат одного раунда.
 * Медяки здесь не показываем: ставка разыгрывается за матч целиком,
 * итоговый расчёт — на экране итогов.
 */
export function ResultScreen({
  round,
  config,
  score,
  isLastRound,
  onContinue,
}: {
  round: RoundResult
  config: MatchConfig
  score: { player: number; opponent: number }
  isLastRound: boolean
  onContinue: () => void
}) {
  const t = useT()
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowResult(true), 800)
    return () => clearTimeout(timer)
  }, [])

  const config_: Record<Outcome, { label: string; color: string; glow: string; emoji: string; bg: string }> = {
    win: {
      label: t('result.win'),
      color: 'text-tg-green',
      glow: 'text-glow-green',
      emoji: '🏆',
      bg: 'rgba(42, 202, 92, 0.08)',
    },
    lose: {
      label: t('result.lose'),
      color: 'text-tg-red',
      glow: 'text-glow-red',
      emoji: '💀',
      bg: 'rgba(229, 82, 82, 0.08)',
    },
    draw: {
      label: t('result.draw'),
      color: 'text-tg-yellow',
      glow: '',
      emoji: '🤝',
      bg: 'rgba(255, 214, 10, 0.08)',
    },
  }

  const cfg = config_[round.outcome]

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom items-center px-4">
      {/* Соперник и номер раунда */}
      <div className="w-full pt-4 pb-2">
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl glass-strong flex items-center justify-center text-lg flex-shrink-0">
            {config.opponentAvatar}
          </div>
          <span className="text-sm font-bold text-tg-text truncate flex-1">{config.opponentName}</span>
          <span className="text-tg-subtext text-xs font-semibold flex-shrink-0">
            {t('battle.roundOf', { current: round.round, total: config.roundsTotal })}
          </span>
        </div>
      </div>

      {/* Столкновение: слева соперник, справа игрок */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="flex items-center justify-center gap-6">
          {/* Руки развёрнуты навстречу друг другу (правка 1/3) */}
          <Hand
            choice={round.opponentChoice}
            side="left"
            className={`text-7xl animate-collision-left ${round.outcome === 'lose' ? 'animate-float' : ''}`}
          />
          <div className="flex flex-col items-center">
            <div
              className="glass rounded-full w-12 h-12 flex items-center justify-center text-xl"
              style={{ background: cfg.bg }}
            >
              💥
            </div>
          </div>
          <Hand
            choice={round.playerChoice}
            side="right"
            className={`text-7xl animate-collision-right ${round.outcome === 'win' ? 'animate-float' : ''}`}
          />
        </div>

        {showResult && (
          <div className="flex flex-col items-center gap-3 animate-scale-in">
            <div className="text-5xl">{cfg.emoji}</div>
            <div className={`text-4xl font-black ${cfg.color} ${cfg.glow}`}>{cfg.label}</div>
            {config.roundsTotal > 1 && (
              <div className="glass rounded-2xl px-6 py-3 flex items-center gap-3">
                <span className="text-tg-subtext text-xs uppercase tracking-wider">
                  {t('summary.roundsRecap')}
                </span>
                <span className="text-2xl font-black font-mono text-tg-text">
                  {score.opponent}:{score.player}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-full pb-4">
        <PrimaryButton onClick={onContinue}>
          {isLastRound ? t('result.toSummary') : t('result.nextRound')}
        </PrimaryButton>
      </div>
    </div>
  )
}
