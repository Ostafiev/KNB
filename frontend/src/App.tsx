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
import { DevBar } from './components/DevBar'
import { SHOW_DEV_BAR } from './config/env'
import { ECONOMY, eloUpdate, roundsToWin } from './config/economy'
import { randomChoice, resolveRound } from './lib/game'
import { useAppState } from './state/AppState'
import { OPPONENTS } from './data/mock'
import { initTelegram } from './telegram/sdk'
import type { HandChoice, MatchConfig, Outcome, RoundResult, Screen, Tab } from './types'

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
  const [opponentsTab, setOpponentsTab] = useState<Tab>('random')
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

  const openOpponents = useCallback(
    (tab: Tab) => {
      setOpponentsTab(tab)
      go('opponents')
    },
    [go],
  )

  /**
   * Старт матча.
   * ЧАСТЬ 5 — если медяков не хватает, не блокируем действие,
   * а предлагаем посмотреть рекламу или пополнить баланс.
   * Бесплатный матч (ставка 0) проверку баланса не проходит вовсе.
   */
  const startMatch = useCallback(
    (config: MatchConfig) => {
      if (config.bet > ECONOMY.FREE_BET && balance < config.bet) {
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

  /** Правка 14: «Следующий бой» — новый соперник, условия те же, без подтверждений. */
  const nextBattle = useCallback(() => {
    startMatch({
      mode: 'random',
      bet: match.bet === ECONOMY.FREE_BET ? ECONOMY.MIN_BET : match.bet,
      roundsTotal: match.roundsTotal,
      condition: '',
      opponentName: '',
      opponentAvatar: '👤',
      opponentRating: ECONOMY.ELO_START,
    })
  }, [match.bet, match.roundsTotal, startMatch])

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

      /*
       * Бесплатный матч (правка 20) не влияет ни на баланс, ни на рейтинг,
       * ни на счётчик сыгранных игр — иначе порог вывода (15 матчей из ЧАСТИ 5)
       * накручивался бы бесплатными играми с другом.
       * TODO(backend): то же правило должно жить на сервере, клиенту здесь верить нельзя.
       */
      if (match.bet === ECONOMY.FREE_BET) {
        setMatchOutcome(outcome)
        setRatingDelta(0)
        go('summary')
        return
      }

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
   * TODO(backend): боты должны вести себя как живые игроки — задержка хода,
   * неидеальная стратегия, правдоподобный профиль.
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

  const screens = (
    <>
        {screen === 'splash' && (
          <SplashScreen onPlay={() => go(consentAccepted ? 'home' : 'consent')} />
        )}

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
            onOpponents={openOpponents}
            onCreate={() => go('create')}
            onStartMatch={startMatch}
          />
        )}

        {screen === 'opponents' && (
          <OpponentsScreen initialTab={opponentsTab} onSelect={startMatch} onBack={() => go('home')} />
        )}

        {screen === 'create' && <CreateScreen onCreate={startMatch} onBack={() => go('home')} />}

        {screen === 'waiting' && (
          <WaitingScreen onCancel={() => go('home')} bet={match.bet} rounds={match.roundsTotal} />
        )}

        {screen === 'battle' && (
          <BattleScreen
            // Ключ сбрасывает таймер и вступление на каждом новом раунде
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
            onNextBattle={nextBattle}
            onRematch={startMatch}
            onMenu={() => go('home')}
          />
        )}

      {insufficientFor !== null && (
        <InsufficientBalanceSheet needed={insufficientFor} onClose={() => setInsufficientFor(null)} />
      )}
    </>
  )

  /*
   * ЧАСТЬ 2, п.8 — панель переключения экранов только в DEV-сборке.
   * Там она встаёт над приложением в одной колонке, а экран скроллится внутри
   * своей области — иначе фиксированный бар перекрывал бы верх экрана.
   * В PROD разметка обычная: скроллится сам документ.
   */
  if (SHOW_DEV_BAR) {
    return (
      <div className="flex flex-col" style={{ height: '100vh', background: 'var(--tg-bg)' }}>
        <DevBar screen={screen} onGo={go} />
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto relative" style={{ maxWidth: 390 }}>
            {screens}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--tg-bg)' }}>
      <div className="mx-auto relative" style={{ maxWidth: 390, minHeight: '100vh' }}>
        {screens}
      </div>
    </div>
  )
}
