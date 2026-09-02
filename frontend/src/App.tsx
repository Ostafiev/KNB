import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SplashScreen } from './screens/SplashScreen'
import { ConsentScreen } from './screens/ConsentScreen'
import { NameScreen } from './screens/NameScreen'
import { HomeScreen } from './screens/HomeScreen'
import { OpponentsScreen } from './screens/OpponentsScreen'
import { CreateScreen } from './screens/CreateScreen'
import { WaitingScreen } from './screens/WaitingScreen'
import { BattleScreen } from './screens/BattleScreen'
import { ResultScreen } from './screens/ResultScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { InsufficientBalanceSheet } from './sheets/MiscSheets'
import { IncomingChallengeSheet, OutgoingChallengeBanner } from './sheets/ChallengeSheets'
import { InviteReadySheet, InviteWaitingBanner } from './sheets/InviteReadySheet'
import { DevBar } from './components/DevBar'
import { SHOW_DEV_BAR } from './config/env'
import { ECONOMY, eloUpdate, roundsToWin } from './config/economy'
import { randomChoice, resolveRound } from './lib/game'
import { api } from './api/client'
import { useAppState } from './state/AppState'
import { useT } from './i18n'
import { useLiveMatch } from './state/LiveMatch'
import { OPPONENTS, avatarEmoji } from './data/mock'
import {
  initTelegram,
  getStartParam,
  shareLink,
  chatPickerBroken,
  openChatPicker,
  telegramDiagnostics,
} from './telegram/sdk'
import { buildInviteMessage, buildInviteUrl } from './lib/invite'
import type { MatchView } from './api/client'
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

/** Условия матча из того, что прислал сервер. */
function configFromServer(view: MatchView): MatchConfig {
  return {
    mode: view.mode,
    bet: view.bet,
    roundsTotal: view.roundsTotal,
    condition: view.condition ?? '',
    opponentName: view.opponent?.nickname ?? '',
    opponentAvatar: avatarEmoji(view.opponent?.avatarId ?? 'gamepad'),
    opponentRating: view.opponent?.rating ?? ECONOMY.ELO_START,
  }
}

/** Сыгранные раунды сервера — в вид, который понимают экраны. */
function roundsFromServer(view: MatchView): RoundResult[] {
  return view.rounds
    .filter((round) => round.resolvedAt !== null)
    .map((round) => ({
      round: round.display,
      playerChoice: (round.myChoice ?? 'rock') as HandChoice,
      opponentChoice: (round.opponentChoice ?? 'rock') as HandChoice,
      outcome: round.result === 'win' ? 'win' : round.result === 'loss' ? 'lose' : 'draw',
    }))
}

export default function App() {
  const {
    consentAccepted,
    acceptConsent,
    profileReady,
    finishProfile,
    balance,
    rating,
    recordMatch,
    status,
    demoPlayAllowed,
  } = useAppState()
  const live = useLiveMatch()
  const t = useT()

  const [screen, setScreen] = useState<Screen>('splash')
  const [opponentsTab, setOpponentsTab] = useState<Tab>('random')
  const [match, setMatch] = useState<MatchConfig>(EMPTY_MATCH)
  const [rounds, setRounds] = useState<RoundResult[]>([])
  const [score, setScore] = useState({ player: 0, opponent: 0 })
  const [matchOutcome, setMatchOutcome] = useState<Outcome>('draw')
  const [ratingDelta, setRatingDelta] = useState(0)
  const [insufficientFor, setInsufficientFor] = useState<number | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  /** Человек нажал «позвать друга», а не просто создал бой. */
  const [inviteIntent, setInviteIntent] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)

  // Матч засчитывается один раз, даже если экран итогов перерисуется.
  const settled = useRef(false)

  useEffect(() => {
    initTelegram()
  }, [])

  const go = useCallback((next: Screen) => setScreen(next), [])

  /*
   * Заставка — приветствие, а не пропускной пункт. Тому, кто уже играл,
   * она не нужна: он открыл приложение, чтобы играть, а не нажимать
   * «Начать игру» ещё раз. Поэтому вернувшийся сразу попадает на главную.
   */
  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current || screen !== 'splash') return
    if (status === 'connecting') return
    if (!consentAccepted) return
    greeted.current = true
    go(profileReady ? 'home' : 'name')
  }, [screen, status, consentAccepted, profileReady, go])

  const openOpponents = useCallback(
    (tab: Tab) => {
      setOpponentsTab(tab)
      go('opponents')
    },
    [go],
  )

  /*
   * Два режима.
   *   Живой   — сервер на связи: соперник настоящий, ходы и счёт считает он.
   *   Демо    — сервера нет (статичное превью): приложение играет само с собой,
   *             чтобы витрина оставалась кликабельной.
   */
  const liveOn = live.available

  // ─── Живой матч ────────────────────────────────────────────────────────────

  const liveConfig = live.match ? configFromServer(live.match) : null
  const liveRounds = useMemo(() => (live.match ? roundsFromServer(live.match) : []), [live.match])

  /** Переходы между экранами по событиям сервера. */
  useEffect(() => {
    if (!liveOn || !live.signal) return

    switch (live.signal.kind) {
      case 'match_found':
        setInviteLink(null)
        go('battle')
        return
      case 'round_result': {
        /*
         * Небольшая задержка: за неё в бою успевает пройти замах — руки
         * сходятся на счёт «три», и только потом открываются фигуры.
         * Сервер держит паузу между раундами дольше, так что времени хватает.
         */
        const timer = setTimeout(() => go('result'), 750)
        return () => clearTimeout(timer)
      }
      case 'round_started':
        go('battle')
        return
      case 'match_finished':
        setInviteLink(null)
        go('summary')
        return
      case 'error':
        if (live.signal.code === 'insufficient_funds') {
          setInsufficientFor(live.match?.bet ?? ECONOMY.MIN_BET)
          go('home')
          return
        }
        setLiveError(live.signal.message ?? 'Что-то пошло не так')
        return
    }
  }, [live.signal, liveOn, live.match?.bet, go])

  /**
   * Отправка приглашения другу.
   *
   * Сначала просим Telegram подготовить сообщение и показываем родное окно
   * выбора чата — то самое, где человек выбирает друга из своих контактов.
   * Если версия Telegram старая или подготовить не удалось, остаётся прежний
   * путь: ссылка с готовым текстом через обычное «поделиться».
   */
  const openShare = useCallback(
    async (matchId: number, config: MatchConfig) => {
      /*
       * Главный путь — родное окно Telegram «кому отправить».
       *
       * Если оно не открылось, человек должен увидеть причину, а не гадать:
       * в сообщении и ответ сервера, и версия Telegram. С этим можно прийти
       * и починить, а «ничего не произошло» разбору не поддаётся.
       */
      let reason = ''
      try {
        const prepared = await api.prepareShare(matchId)
        if (!prepared.preparedMessageId) {
          reason = prepared.reason ?? 'Telegram не подготовил сообщение'
        } else if (chatPickerBroken()) {
          // Уже знаем, что этот клиент такую команду не понимает.
          reason = ''
        } else {
          const outcome = await openChatPicker(prepared.preparedMessageId)
          if (outcome === 'opened') return
          // «Проглотил команду» — не поломка, а предел этого клиента:
          // молча уходим запасным путём, не пугая человека ошибкой.
          reason = outcome === 'ignored' ? '' : `окно не открылось: ${outcome.error}`
        }
      } catch {
        reason = 'сервер не ответил'
      }

      /*
       * Запасной путь: та же ссылка с тем же текстом, но через обычное
       * «поделиться». Окно со списком чатов тоже родное — просто открывает
       * его Telegram по-другому, и это умеет любой клиент.
       */
      const sent = shareLink(
        buildInviteUrl(`match_${matchId}`),
        buildInviteMessage(t, {
          bet: config.bet,
          rounds: config.roundsTotal,
          condition: config.condition,
        }),
      )

      // Молчим, только если запасной путь сработал и жаловаться не на что.
      if (sent && !reason) return
      setLiveError(`${t('invite.shareFailed')} · ${reason || 'запасной путь тоже не открылся'} · ${telegramDiagnostics()}`)
    },
    [t],
  )

  /**
   * Что стало с отправленным вызовом. Друг мог отказаться или не ответить —
   * без сообщения окно просто исчезло бы, и это выглядело бы как сбой.
   */
  const challengeOutcome = live.challengeOutcome
  useEffect(() => {
    if (!challengeOutcome) return
    if (challengeOutcome.outcome === 'cancelled') return
    setLiveError(
      challengeOutcome.outcome === 'declined'
        ? t('challenge.declined')
        : t('challenge.expired'),
    )
    const timer = setTimeout(() => setLiveError(null), 4000)
    return () => clearTimeout(timer)
  }, [challengeOutcome, t])

  /** Вход по ссылке-приглашению: t.me/бот?startapp=match_123 */
  const handledStartParam = useRef(false)
  useEffect(() => {
    if (!liveOn || handledStartParam.current) return
    const param = getStartParam()
    if (!param?.startsWith('match_')) return

    handledStartParam.current = true
    const matchId = Number(param.slice(6))
    if (!Number.isSafeInteger(matchId)) return

    void live
      .join(matchId)
      .then((match) => {
        // Хозяина нет на связи — бой не начался, ждём встречи на главной.
        go(match ? 'battle' : 'home')
      })
      .catch(() => setLiveError('Приглашение уже недействительно'))
  }, [liveOn, live, go])

  // ─── Старт матча ───────────────────────────────────────────────────────────

  /**
   * ЧАСТЬ 5 — если медяков не хватает, не блокируем действие,
   * а предлагаем посмотреть рекламу или пополнить баланс.
   * Бесплатный матч (ставка 0) проверку баланса не проходит вовсе.
   */
  const startMatch = useCallback(
    (config: MatchConfig, options: { share?: boolean } = {}) => {
      if (config.bet > ECONOMY.FREE_BET && balance < config.bet) {
        setInsufficientFor(config.bet)
        return
      }

      /*
       * Внутри Telegram играть можно только по-настоящему. Если сервера нет,
       * честно говорим об этом: подставить выдуманного соперника значило бы
       * соврать игроку, что он играет с человеком.
       */
      if (!liveOn && !demoPlayAllowed) {
        setLiveError(status === 'connecting' ? 'Подключаемся к серверу…' : 'Нет связи с сервером')
        return
      }

      // Человек шёл звать друга — значит, на экране ожидания главным должно
      // быть «выбрать друга», а не ссылка и не отмена.
      setInviteIntent(Boolean(options.share))

      settled.current = false
      setMatch(config)
      setRounds([])
      setScore({ player: 0, opponent: 0 })
      setMatchOutcome('draw')
      setRatingDelta(0)
      setInviteLink(null)

      if (liveOn) {
        if (config.mode === 'friend') {
          // С другом играют по ссылке: сервер заводит матч и ждёт второго.
          void live
            .createInvite({
              bet: config.bet,
              rounds: config.roundsTotal,
              condition: config.condition || undefined,
            })
            .then(({ startParam }) => {
              setInviteLink(startParam)
              /*
               * Окно выбора чата открывается только по живому нажатию.
               *
               * Раньше приложение пыталось открыть его само, как только сервер
               * заведёт матч. Между нажатием и этим моментом успевал пройти
               * запрос к серверу — и для Telegram это была уже не реакция на
               * палец человека, а самодеятельность страницы. Такое он молча
               * не выполняет: ни окна, ни ответа.
               *
               * Хуже того, эта попытка запирала дверь изнутри: внутри Telegram
               * взводился засов «окно уже показано», и следующее нажатие,
               * настоящее, падало с ошибкой. Поэтому здесь мы только готовим
               * ссылку, а окно открывает сам человек кнопкой.
               */
            })
            .catch((error: unknown) => {
              // Показываем настоящую причину: «не удалось» ничего не объясняет.
              const message =
                error instanceof Error && error.message ? error.message : 'Не удалось создать приглашение'
              setLiveError(message)
            })
        } else {
          live.queue(config.bet, config.roundsTotal)
        }
      }

      go('waiting')
    },
    [balance, go, liveOn, live, demoPlayAllowed, status, t, openShare],
  )

  /** Правка 14: «Следующий бой» — новый соперник, условия те же, без подтверждений. */
  const nextBattle = useCallback(() => {
    live.reset()
    startMatch({
      mode: 'random',
      bet: match.bet === ECONOMY.FREE_BET ? ECONOMY.MIN_BET : match.bet,
      roundsTotal: match.roundsTotal,
      condition: '',
      opponentName: '',
      opponentAvatar: '👤',
      opponentRating: ECONOMY.ELO_START,
    })
  }, [match.bet, match.roundsTotal, startMatch, live])

  /** Войти в конкретный открытый бой из списка. */
  const joinOpenMatch = useCallback(
    (matchId: number) => {
      setInviteLink(null)
      void live
        .join(matchId)
        .then(() => go('battle'))
        .catch((error: unknown) => {
          const code = (error as { code?: string }).code
          if (code === 'insufficient_funds') {
            setInsufficientFor(ECONOMY.MIN_BET)
            return
          }
          setLiveError(
            code === 'match_full' || code === 'match_not_joinable'
              ? 'В этот бой уже вошёл другой игрок'
              : 'Не удалось войти в бой',
          )
        })
    },
    [live, go],
  )

  const leaveMatch = useCallback(() => {
    if (liveOn) live.leave()
    go('home')
  }, [liveOn, live, go])

  // ─── Демо-режим ────────────────────────────────────────────────────────────

  // Подбор соперника без сервера: через паузу подставляем игрока из списка.
  // Только вне Telegram — см. demoPlayAllowed.
  useEffect(() => {
    if (liveOn || !demoPlayAllowed) return
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
  }, [screen, go, liveOn, demoPlayAllowed])

  /** Завершение матча в демо-режиме: считаем Elo и пишем результат локально. */
  const settleMatch = useCallback(
    (outcome: Outcome) => {
      if (settled.current) return
      settled.current = true

      /*
       * Бесплатный матч (правка 20) не влияет ни на баланс, ни на рейтинг,
       * ни на счётчик сыгранных игр — иначе порог вывода (15 матчей из ЧАСТИ 5)
       * накручивался бы бесплатными играми с другом. На сервере это же
       * правило живёт в domain/match.ts.
       */
      if (match.bet === ECONOMY.FREE_BET) {
        setMatchOutcome(outcome)
        setRatingDelta(0)
        go('summary')
        return
      }

      const scoreValue = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
      const delta = eloUpdate(rating, match.opponentRating, scoreValue, ECONOMY.ELO_K) - rating
      setMatchOutcome(outcome)
      setRatingDelta(delta)
      recordMatch({ outcome, bet: match.bet, ratingDelta: delta })
      go('summary')
    },
    [rating, match.opponentRating, match.bet, recordMatch, go],
  )

  /** Ход игрока. В живом матче фигуру отправляем на сервер, он и решает исход. */
  const handleChoice = useCallback(
    (choice: HandChoice) => {
      if (liveOn) {
        live.move(choice)
        return
      }

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
    [go, liveOn, live],
  )

  // ─── Общее для обоих режимов ───────────────────────────────────────────────

  const activeConfig = liveOn && liveConfig ? liveConfig : match
  const activeRounds = liveOn && live.match ? liveRounds : rounds
  const activeScore =
    liveOn && live.match
      ? { player: live.match.myScore, opponent: live.match.opponentScore }
      : score

  const target = roundsToWin(activeConfig.roundsTotal)
  const matchDecided = liveOn
    ? (live.match?.finished ?? false)
    : score.player >= target || score.opponent >= target || rounds.length >= match.roundsTotal

  /** Переход с экрана результата — только в демо-режиме, в живом ведёт сервер. */
  const continueFromResult = useCallback(() => {
    if (liveOn) return
    if (!matchDecided) {
      go('battle')
      return
    }
    settleMatch(
      score.player > score.opponent ? 'win' : score.player < score.opponent ? 'lose' : 'draw',
    )
  }, [matchDecided, score, settleMatch, go, liveOn])

  const lastRound = activeRounds[activeRounds.length - 1]

  const outcomeForSummary: Outcome =
    liveOn && live.match
      ? live.match.cancelled
        ? 'draw'
        : live.match.won
          ? 'win'
          : 'lose'
      : matchOutcome
  const deltaForSummary = liveOn && live.match ? live.match.ratingDelta : ratingDelta

  const screens = (
    <>
        {screen === 'splash' && (
          <SplashScreen
            onPlay={() => go(!consentAccepted ? 'consent' : profileReady ? 'home' : 'name')}
          />
        )}

        {screen === 'consent' && (
          <ConsentScreen
            onAccept={() => {
              acceptConsent()
              go(profileReady ? 'home' : 'name')
            }}
          />
        )}

        {screen === 'name' && (
          <NameScreen
            onDone={() => {
              finishProfile()
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
          <OpponentsScreen
            initialTab={opponentsTab}
            onSelect={startMatch}
            onJoinOpen={joinOpenMatch}
            onCreate={() => go('create')}
            onBack={() => go('home')}
          />
        )}

        {screen === 'create' && <CreateScreen onCreate={startMatch} onBack={() => go('home')} />}

        {screen === 'waiting' && (
          <WaitingScreen
            onCancel={leaveMatch}
            bet={activeConfig.bet}
            rounds={activeConfig.roundsTotal}
            condition={activeConfig.condition}
            onShare={
              inviteLink
                ? () => void openShare(Number(inviteLink.replace('match_', '')), activeConfig)
                : undefined
            }
            highlightShare={inviteIntent}
            onLeaveWaiting={
              inviteLink
                ? () => {
                    live.inviteRelease(Number(inviteLink.replace('match_', '')))
                    go('home')
                  }
                : undefined
            }
            inviteStartParam={inviteLink}
          />
        )}

        {screen === 'battle' && (
          <BattleScreen
            // Ключ сбрасывает таймер и вступление на каждом новом раунде
            key={liveOn ? (live.match?.rounds.length ?? 0) : rounds.length}
            config={activeConfig}
            roundNumber={liveOn && live.match ? live.match.currentRound : rounds.length + 1}
            score={activeScore}
            onChoice={handleChoice}
            onSurrender={leaveMatch}
            live={
              liveOn
                ? {
                    endsAt: live.roundEndsAt,
                    opponentMoved: live.opponentMoved,
                    confirmedChoice: live.myChoice,
                  }
                : undefined
            }
          />
        )}

        {screen === 'result' && lastRound && (
          <ResultScreen
            round={lastRound}
            config={activeConfig}
            score={activeScore}
            isLastRound={matchDecided}
            onContinue={continueFromResult}
            autoAdvance={liveOn}
          />
        )}

        {screen === 'summary' && (
          <SummaryScreen
            config={activeConfig}
            outcome={outcomeForSummary}
            rounds={activeRounds}
            score={activeScore}
            ratingDelta={deltaForSummary}
            opponentLeft={liveOn ? (live.match?.opponentLeft ?? false) : false}
            cancelled={liveOn ? (live.match?.cancelled ?? false) : false}
            onNextBattle={nextBattle}
            onRematch={startMatch}
            onMenu={() => {
              live.reset()
              go('home')
            }}
          />
        )}

      {insufficientFor !== null && (
        <InsufficientBalanceSheet needed={insufficientFor} onClose={() => setInsufficientFor(null)} />
      )}

      {/*
        Вызов на бой приходит когда угодно, поэтому окно живёт над всем
        приложением, а не внутри экрана друзей: игрок мог уйти в профиль.
        В бою окно не показываем — оно перекрыло бы ход.
      */}
      {liveOn && live.incoming.length > 0 && screen !== 'battle' && (
        <IncomingChallengeSheet
          challenge={live.incoming[0]}
          onAccept={() => live.acceptChallenge(live.incoming[0].matchId)}
          onDecline={() => live.declineChallenge(live.incoming[0].matchId)}
        />
      )}

      {liveOn && live.outgoing && screen !== 'battle' && (
        <OutgoingChallengeBanner
          challenge={live.outgoing}
          onCancel={() => live.cancelChallenge(live.outgoing!.matchId)}
        />
      )}

      {/*
        Приглашение другу. Окно всплывает, когда человек вернулся
        в приложение и его уже ждут: сидеть на экране ожидания не нужно.
      */}
      {liveOn && live.invite && screen !== 'battle' && (
        <InviteReadySheet
          invite={live.invite}
          iAmHost={live.invite.host.id === live.myId}
          onPlay={() => live.inviteReady(live.invite!.matchId)}
          onLater={() => live.inviteLater(live.invite!.matchId)}
        />
      )}

      {liveOn && live.waitingForInvite && screen !== 'battle' && screen !== 'waiting' && (
        <InviteWaitingBanner
          invite={live.waitingForInvite}
          iAmHost={live.waitingForInvite.host.id === live.myId}
          onCancel={() => live.inviteRelease(live.waitingForInvite!.matchId)}
        />
      )}

      {liveError && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 glass-strong rounded-2xl px-4 py-3 text-sm text-tg-text border border-tg-red/40 animate-slide-up"
          style={{ bottom: 'max(env(safe-area-inset-bottom), 16px)', maxWidth: 340 }}
          onClick={() => setLiveError(null)}
        >
          {liveError}
        </div>
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
