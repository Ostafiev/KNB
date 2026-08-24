import { useCallback, useEffect, useRef, useState } from 'react'
import { SplashScreen } from './screens/SplashScreen'
import { ConsentScreen } from './screens/ConsentScreen'
import { HomeScreen } from './screens/HomeScreen'
import { OpponentsScreen } from './screens/OpponentsScreen'
import { CreateScreen } from './screens/CreateScreen'
import { WaitingScreen } from './screens/WaitingScreen'
import { BattleScreen } from './screens/BattleScreen'
import { ResultScreen } from './screens/ResultScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { InsufficientBalanceSheet } from './sheets/MiscSheets'
import { DevBar, DEV_BAR_HEIGHT } from './components/DevBar'
import { SHOW_DEV_BAR } from './config/env'
import { ECONOMY, eloUpdate, roundsToWin } from './config/economy'
import { randomChoice, resolveRound } from './lib/game'
import { useAppState } from './state/AppState'
import { OPPONENTS } from './data/mock'
import { initTelegram } from './telegram/sdk'
import type { HandChoice, MatchConfig, Outcome, RoundResult, Screen } from './types'

const EMPTY_MATCH: MatchConfig = {
  mode: 'random',
  bet: 100,
  roundsTotal: 3,
  condition: '',
  opponentName: 'Мария Т.',
  opponentAvatar: '👩‍🎨',
  opponentRating: 2110,
}

export default function App() {
  const { consentAccepted, acceptConsent, balance, rating, recordMatch } = useAppState()

  const [screen, setScreen] = useState<Screen>('splash')
  const [match, setMatch] = useState<MatchConfig>(EMPTY_MATCH)
  const [rounds, setRounds] = useState<RoundResult[]>([])
  const [score, setScore] = useState({ player: 0, opponent: 0 })
  const [matchOutcome, setMatchOutcome] = useState<Outcome>('draw')
  const [ratingDelta, setRatingDelta] = useState(0)
  const [insufficientFor, setInsufficientFor] = useState<number | null>(null)

  // Матч засчитывается один раз, даже если экран итогов перерисуется.
  const settled = useRef(false)

  useEffect(() => {
    initTelegram()
  }, [])

  const go = useCallback((next: Screen) => setScreen(next), [])

  /**
   * Старт матча.
   * ЧАСТЬ 5 — если медяков не хватает, не блокируем действие,
   * а предлагаем посмотреть рекламу или пополнить баланс.
   */
  const startMatch = useCallback(
    (config: MatchConfig) => {
      if (balance < config.bet) {
        setInsufficientFor(config.bet)
        return
      }
      settled.current = false
      setMatch(config)
      setRounds([])
      setScore({ player: 0, opponent: 0 })
      setMatchOutcome('draw')
      setRatingDelta(0)
      go('waiting')
    },
    [balance, go],
  )

  // Подбор соперника. TODO(backend): заменить на матчмейкинг через Redis + WebSocket.
  useEffect(() => {
    if (screen !== 'waiting') return
    const timer = setTimeout(() => {
      setMatch((prev) => {
        if (prev.opponentName) return prev
        const pick = OPPONENTS[Math.floor(Math.random() * OPPONENTS.length)]
        return {
          ...prev,
          opponentName: pick.name,
          opponentAvatar: pick.avatar,
          opponentRating: pick.rating,
        }
      })
      go('battle')
    }, 2500)
    return () => clearTimeout(timer)
  }, [screen, go])

  /** Завершение матча: фиксируем итог, считаем Elo и пишем результат в профиль. */
  const settleMatch = useCallback(
    (outcome: Outcome) => {
      if (settled.current) return
      settled.current = true
      const scoreValue = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
      // TODO(backend): рейтинг и баланс считает сервер; здесь — оптимистичный расчёт.
      const delta = eloUpdate(rating, match.opponentRating, scoreValue, ECONOMY.ELO_K) - rating
      setMatchOutcome(outcome)
      setRatingDelta(delta)
      recordMatch({ outcome, bet: match.bet, ratingDelta: delta })
      go('summary')
    },
    [rating, match.opponentRating, match.bet, recordMatch, go],
  )

  /**
   * Ход игрока.
   * TODO(backend): выбор соперника приходит с сервера; сервер же валидирует
   * тайминг хода (античит, ЧАСТЬ 3, п.5). Сейчас соперник ходит случайно.
   */
  const handleChoice = useCallback(
    (choice: HandChoice) => {
      const opponentChoice = randomChoice()
      const outcome = resolveRound(choice, opponentChoice)
      setRounds((prev) => [
        ...prev,
        { round: prev.length + 1, playerChoice: choice, opponentChoice, outcome },
      ])
      setScore((prev) => ({
        player: prev.player + (outcome === 'win' ? 1 : 0),
        opponent: prev.opponent + (outcome === 'lose' ? 1 : 0),
      }))
      go('result')
    },
    [go],
  )

  const target = roundsToWin(match.roundsTotal)
  const matchDecided =
    score.player >= target || score.opponent >= target || rounds.length >= match.roundsTotal

  /** Переход с экрана результата: следующий раунд либо итоги матча. */
  const continueFromResult = useCallback(() => {
    if (!matchDecided) {
      go('battle')
      return
    }
    settleMatch(score.player > score.opponent ? 'win' : score.player < score.opponent ? 'lose' : 'draw')
  }, [matchDecided, score, settleMatch, go])

  const lastRound = rounds[rounds.length - 1]

  return (
    <div className="min-h-screen" style={{ background: 'var(--tg-bg)' }}>
      {/* ЧАСТЬ 2, п.8 — панель переключения экранов только в DEV-сборке */}
      {SHOW_DEV_BAR && <DevBar screen={screen} onGo={go} />}

      <div
        className="mx-auto relative"
        style={{ maxWidth: 390, minHeight: '100vh', paddingTop: SHOW_DEV_BAR ? DEV_BAR_HEIGHT : 0 }}
      >
        {screen === 'splash' && (
          <SplashScreen onPlay={() => go(consentAccepted ? 'home' : 'consent')} />
        )}

        {/* ЧАСТЬ 2, п.13 — согласие показывается один раз при первом входе */}
        {screen === 'consent' && (
          <ConsentScreen
            onAccept={() => {
              acceptConsent()
              go('home')
            }}
          />
        )}

        {screen === 'home' && (
          <HomeScreen
            onOpponents={() => go('opponents')}
            onCreate={() => go('create')}
            onStartMatch={startMatch}
          />
        )}

        {screen === 'opponents' && <OpponentsScreen onSelect={startMatch} onBack={() => go('home')} />}

        {screen === 'create' && <CreateScreen onCreate={startMatch} onBack={() => go('home')} />}

        {screen === 'waiting' && (
          <WaitingScreen onCancel={() => go('home')} bet={match.bet} rounds={match.roundsTotal} />
        )}

        {screen === 'battle' && (
          <BattleScreen
            // Ключ сбрасывает таймер и обратный отсчёт на каждом новом раунде
            key={rounds.length}
            config={match}
            roundNumber={rounds.length + 1}
            score={score}
            onChoice={handleChoice}
            onSurrender={() => settleMatch('lose')}
          />
        )}

        {screen === 'result' && lastRound && (
          <ResultScreen
            round={lastRound}
            config={match}
            score={score}
            isLastRound={matchDecided}
            onContinue={continueFromResult}
          />
        )}

        {screen === 'summary' && (
          <SummaryScreen
            config={match}
            outcome={matchOutcome}
            rounds={rounds}
            score={score}
            ratingDelta={ratingDelta}
            onRematch={startMatch}
            onMenu={() => go('home')}
          />
        )}

        {insufficientFor !== null && (
          <InsufficientBalanceSheet needed={insufficientFor} onClose={() => setInsufficientFor(null)} />
        )}
      </div>
    </div>
  )
}
