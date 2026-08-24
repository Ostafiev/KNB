import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { ECONOMY } from '../config/economy'
import { CHOICES, CHOICE_LABEL_KEY, HAND_EMOJI, randomChoice } from '../lib/game'
import { haptic, hapticNotify } from '../telegram/sdk'
import type { HandChoice, MatchConfig } from '../types'

/** Длительность финальной фазы тряски перед раскрытием (ЧАСТЬ 2, п.7). */
const FINAL_SHAKE_MS = 400

type Phase = 'countdown' | 'choose' | 'final-shake'

export function BattleScreen({
  config,
  roundNumber,
  score,
  onChoice,
  onSurrender,
}: {
  config: MatchConfig
  roundNumber: number
  score: { player: number; opponent: number }
  onChoice: (choice: HandChoice) => void
  onSurrender: () => void
}) {
  const t = useT()
  const { nickname, avatar, soundEnabled, setSoundEnabled } = useAppState()

  const [countdown, setCountdown] = useState(3)
  const [phase, setPhase] = useState<Phase>('countdown')
  const [selected, setSelected] = useState<HandChoice | null>(null)
  const [idleShaking, setIdleShaking] = useState(false)
  const [roundTimer, setRoundTimer] = useState<number>(ECONOMY.ROUND_SECONDS)
  const [showSurrender, setShowSurrender] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  // Защита от двойного резолва: таймаут и клик могут прийти почти одновременно.
  const committed = useRef(false)

  // Обратный отсчёт перед раундом
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
      return () => clearTimeout(timer)
    }
    setPhase('choose')
    setIdleShaking(true)
    const timer = setTimeout(() => setIdleShaking(false), 2000)
    return () => clearTimeout(timer)
  }, [countdown])

  /**
   * Фиксация хода: показываем финальную фазу тряски и только затем раскрываем фигуры.
   * Один и тот же путь и для ручного выбора, и для автоподстановки по таймауту.
   */
  const commit = (choice: HandChoice) => {
    if (committed.current) return
    committed.current = true
    setSelected(choice)
    setPhase('final-shake')
    haptic('medium')
    setTimeout(() => onChoice(choice), FINAL_SHAKE_MS)
  }

  // Таймер раунда; по истечении ход делается случайно
  useEffect(() => {
    if (phase !== 'choose') return
    if (roundTimer <= 0) {
      hapticNotify('warning')
      commit(randomChoice())
      return
    }
    const timer = setTimeout(() => setRoundTimer((v) => v - 1), 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundTimer])

  const timerUrgent = roundTimer <= 3
  const finalShake = phase === 'final-shake'
  const handAnimation = finalShake ? 'animate-shake-final' : idleShaking ? 'animate-shake' : 'animate-float'

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom relative">
      {/* Иконки меню и выхода — правый верхний угол, разведены между собой */}
      <div
        className="absolute top-0 right-0 z-10 flex items-center gap-2 px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
      >
        <button
          onClick={() => setShowMenu(true)}
          className="tappable w-8 h-8 rounded-xl glass flex items-center justify-center text-tg-subtext border border-tg-border"
          aria-label="Меню"
        >
          ⋯
        </button>
        <button
          onClick={() => setShowSurrender(true)}
          className="tappable w-8 h-8 rounded-xl glass flex items-center justify-center text-tg-subtext border border-tg-border"
          aria-label={t('battle.surrender.title')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/*
        ЧАСТЬ 2, п.2 — счётчик раунда.
        Мелким текстом слева от шкалы таймера, чтобы не спорить с ней за внимание.
      */}
      <div className="px-4 pt-2 mb-1" style={{ paddingRight: 92 }}>
        <div className="flex items-baseline gap-2">
          <span className="text-tg-subtext text-xs font-semibold tracking-wide">
            {t('battle.roundOf', { current: roundNumber, total: config.roundsTotal })}
          </span>
          {config.roundsTotal > 1 && (
            <span className="text-tg-subtext text-xs font-mono opacity-70">
              {t('battle.score', { player: score.player, opponent: score.opponent })}
            </span>
          )}
        </div>
      </div>

      {/* Шкала таймера */}
      {phase !== 'countdown' && (
        <div className="px-4 mb-1">
          <div
            className="glass rounded-xl px-4 py-2 flex items-center gap-3"
            style={{
              border: timerUrgent ? '1px solid var(--tg-red)' : '1px solid var(--tg-border)',
              boxShadow: timerUrgent ? '0 0 16px rgba(229,82,82,0.2)' : 'none',
            }}
          >
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--tg-fill-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${(roundTimer / ECONOMY.ROUND_SECONDS) * 100}%`,
                  background: timerUrgent
                    ? 'linear-gradient(90deg, var(--tg-red), #ff8c8c)'
                    : 'linear-gradient(90deg, var(--tg-blue), var(--tg-blue-light))',
                }}
              />
            </div>
            <span
              className={`font-black text-sm font-mono w-6 text-right transition-colors duration-300 ${
                timerUrgent ? 'text-tg-red' : 'text-tg-blue-light'
              }`}
            >
              {Math.max(0, roundTimer)}
            </span>
            <span className="text-tg-subtext text-xs">{t('battle.seconds')}</span>
          </div>
        </div>
      )}

      {/* Соперник — сверху/слева */}
      <div className="px-4 pb-2">
        <div className="glass rounded-2xl p-3 flex items-center gap-3 opacity-75">
          <div className="w-9 h-9 rounded-xl glass-strong flex items-center justify-center text-lg flex-shrink-0">
            {config.opponentAvatar}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-tg-subtext">{t('common.opponent')}</div>
            <div className="text-sm font-semibold text-tg-subtext truncate max-w-36">{config.opponentName}</div>
          </div>
          <div className="ml-auto flex items-center gap-1 glass rounded-lg px-2 py-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: 'var(--tg-subtext)',
                  animation: `pulse-core 1.2s ${i * 0.3}s ease-in-out infinite`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Условие пари — только в матчах с друзьями (ЧАСТЬ 2, п.11) */}
      {config.condition && (
        <div className="px-4 pb-2">
          <div className="glass rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="text-sm flex-shrink-0">🤝</span>
            <span className="text-tg-subtext text-xs truncate">{config.condition}</span>
          </div>
        </div>
      )}

      {/* Арена */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
        {phase === 'countdown' ? (
          <div className="flex flex-col items-center gap-4">
            <div
              key={countdown}
              className="text-9xl font-black text-transparent bg-clip-text"
              style={{
                backgroundImage: 'linear-gradient(135deg, var(--tg-blue-light), var(--tg-blue))',
                animation: 'countdown 1s ease forwards',
              }}
            >
              {countdown === 0 ? '🥊' : countdown}
            </div>
            <p className="text-tg-subtext text-sm animate-fade-in">{t('battle.getReady')}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full animate-fade-in">
            <div className="flex items-center justify-center gap-8">
              {/* Слева — соперник */}
              <div className={`text-6xl ${handAnimation}`}>✊</div>
              <div className="glass rounded-full w-10 h-10 flex items-center justify-center text-tg-red font-black text-sm glow-red">
                VS
              </div>
              {/* Справа — игрок */}
              <div className={`text-6xl ${handAnimation}`} style={{ animationDelay: finalShake ? '0s' : '0.15s' }}>
                ✊
              </div>
            </div>
            {!selected && (
              <p
                className={`font-bold text-lg transition-colors duration-300 ${
                  timerUrgent ? 'text-tg-red text-glow-red' : 'text-tg-text text-glow-blue'
                }`}
              >
                {timerUrgent ? t('battle.faster') : t('battle.choose')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Игрок — снизу/справа */}
      <div className="px-4 pb-4">
        <div
          className="glass rounded-2xl px-4 py-2 mb-3 flex items-center gap-3"
          style={{ border: '1px solid var(--tg-blue)', boxShadow: '0 0 18px rgba(42,159,214,0.15)' }}
        >
          <div className="flex-1" />
          {/* Правка 23b — вместо подписи «Ты» показываем реальное имя игрока */}
          <div className="text-right min-w-0">
            <div className="text-sm font-bold text-tg-text truncate max-w-40">{nickname}</div>
          </div>
          <div className="w-8 h-8 rounded-xl glass-strong flex items-center justify-center text-base flex-shrink-0">
            {avatar}
          </div>
        </div>

        {/* Кнопки фигур — порядок камень, ножницы, бумага (ЧАСТЬ 2, п.1) */}
        <div className="grid grid-cols-3 gap-3">
          {CHOICES.map((choice) => (
            <button
              key={choice}
              onClick={() => phase === 'choose' && commit(choice)}
              disabled={phase !== 'choose' || selected !== null}
              className={`tappable rounded-2xl py-5 flex flex-col items-center gap-2 transition-all duration-200 border-2 ${
                selected === choice ? 'border-tg-blue glow-blue scale-95 glass-strong' : 'glass border-tg-border'
              } ${phase !== 'choose' && selected !== choice ? 'opacity-40' : ''}`}
            >
              <span className="text-4xl">{HAND_EMOJI[choice]}</span>
              <span className="text-tg-subtext text-xs font-medium">{t(CHOICE_LABEL_KEY[choice])}</span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="mt-3 text-center text-tg-subtext text-sm animate-fade-in">
            {t('battle.waitingOpponent')}
          </div>
        )}
      </div>

      {/* Подтверждение сдачи */}
      {showSurrender && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'var(--tg-scrim)', backdropFilter: 'blur(4px)' }}
        >
          <div className="glass-strong rounded-t-3xl w-full max-w-sm p-6 flex flex-col gap-4 animate-slide-up safe-bottom">
            <div className="text-center">
              <div className="text-4xl mb-2">🏳️</div>
              <div className="text-lg font-black text-tg-text">{t('battle.surrender.title')}</div>
              <div className="text-tg-subtext text-sm mt-1">{t('battle.surrender.body')}</div>
            </div>
            <button
              onClick={() => {
                setShowSurrender(false)
                onSurrender()
              }}
              className="tappable w-full py-4 rounded-2xl font-bold text-tg-red glass border border-tg-red/40"
            >
              {t('battle.surrender.yes')}
            </button>
            <button
              onClick={() => setShowSurrender(false)}
              className="tappable w-full py-3 rounded-2xl font-bold text-tg-text glass border border-tg-border"
            >
              {t('battle.surrender.no')}
            </button>
          </div>
        </div>
      )}

      {/* Меню матча. Пункт «Скорость анимации» удалён — ЧАСТЬ 2, п.6 */}
      {showMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'var(--tg-scrim)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowMenu(false)}
        >
          <div
            className="glass-strong rounded-t-3xl w-full max-w-sm p-5 flex flex-col gap-2 animate-slide-up safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-2" style={{ background: 'var(--tg-fill-3)' }} />
            <button
              onClick={() => {
                setSoundEnabled(!soundEnabled)
                setShowMenu(false)
              }}
              className="tappable glass rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left"
            >
              <span className="text-xl">{soundEnabled ? '🔇' : '🔊'}</span>
              <span className="text-sm font-semibold text-tg-text">
                {soundEnabled ? t('battle.menu.soundOff') : t('battle.menu.soundOn')}
              </span>
            </button>
            <button
              onClick={() => setShowMenu(false)}
              className="tappable glass rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left"
            >
              <span className="text-xl">🐛</span>
              <span className="text-sm font-semibold text-tg-text">{t('battle.menu.report')}</span>
            </button>
            <button
              onClick={() => {
                setShowMenu(false)
                setShowSurrender(true)
              }}
              className="tappable glass rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left border border-tg-red/20"
            >
              <span className="text-xl">🚪</span>
              <span className="text-sm font-semibold text-tg-red">{t('battle.menu.leave')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
