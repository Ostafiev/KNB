import { useCallback, useRef, useState } from 'react'
import { useT, type TranslationKey } from '../i18n'
import { ECONOMY } from '../config/economy'

const APP_VERSION = '1.4.2'

const HOW_TO_CARDS: {
  icon: string
  title: TranslationKey
  body: TranslationKey
  accent: string
  bg: string
}[] = [
  {
    icon: '🪙',
    title: 'howto.1.title',
    body: 'howto.1.body',
    accent: 'var(--tg-yellow)',
    bg: 'rgba(255, 214, 10, 0.12)',
  },
  {
    icon: '✊',
    title: 'howto.2.title',
    body: 'howto.2.body',
    accent: 'var(--tg-blue)',
    bg: 'rgba(42, 159, 214, 0.12)',
  },
  {
    icon: '🏆',
    title: 'howto.3.title',
    body: 'howto.3.body',
    accent: 'var(--tg-green)',
    bg: 'rgba(42, 202, 92, 0.12)',
  },
]

function HowToPlayCard({
  card,
  index,
  active,
}: {
  card: (typeof HOW_TO_CARDS)[number]
  index: number
  active: boolean
}) {
  const t = useT()
  return (
    <div
      className="flex-shrink-0 w-full glass rounded-3xl p-6 flex flex-col gap-4 transition-all duration-300"
      style={{
        border: active ? `1px solid ${card.accent}` : '1px solid var(--tg-border)',
      }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
        style={{ background: card.bg }}
      >
        {card.icon}
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
            style={{ background: card.accent, color: 'var(--tg-bg)' }}
          >
            {index + 1}
          </span>
          <span className="font-black text-tg-text text-base">{t(card.title)}</span>
        </div>
        <p className="text-tg-subtext text-sm leading-relaxed">
          {t(card.body, { seconds: ECONOMY.ROUND_SECONDS })}
        </p>
      </div>
    </div>
  )
}

export function SplashScreen({ onPlay }: { onPlay: () => void }) {
  const t = useT()
  const [showHowTo, setShowHowTo] = useState(false)
  const [activeCard, setActiveCard] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setActiveCard(Math.round(el.scrollLeft / el.offsetWidth))
  }, [])

  return (
    <div className="relative flex flex-col items-center justify-between min-h-screen mesh-bg overflow-hidden safe-top safe-bottom">
      {/* Анимированные кольца */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-72 h-72 rounded-full border border-tg-blue/20 animate-spin-slow" />
        <div
          className="absolute w-52 h-52 rounded-full border border-tg-blue/30"
          style={{ animation: 'spin-slow 5s linear infinite reverse' }}
        />
        <div className="absolute w-32 h-32 rounded-full border border-tg-blue-light/20 animate-spin-slow" />
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center gap-6 px-6 w-full animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 rounded-3xl glow-blue blur-xl opacity-60" />
          <div className="relative glass rounded-3xl p-5 flex flex-col items-center gap-3">
            {/* Порядок фигур — камень, ножницы, бумага (ЧАСТЬ 2, п.1) */}
            <div className="flex gap-2 text-5xl animate-float">
              <span>✊</span>
              <span style={{ animationDelay: '0.3s' }} className="animate-float">✌️</span>
              <span style={{ animationDelay: '0.6s' }} className="animate-float">✋</span>
            </div>
            <div
              className="text-5xl font-black tracking-tight text-transparent bg-clip-text animate-gradient"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, var(--tg-blue-light) 0%, var(--tg-blue) 40%, var(--tg-green) 100%)',
              }}
            >
              КНБ
            </div>
            <div className="text-tg-subtext text-sm font-medium tracking-widest uppercase text-center">
              {t('splash.subtitle')}
            </div>
          </div>
        </div>

        {!showHowTo ? (
          <>
            <p className="text-tg-subtext text-sm text-center leading-relaxed max-w-xs whitespace-pre-line">
              {t('splash.tagline')}
            </p>
            <button
              onClick={() => setShowHowTo(true)}
              className="tappable glass rounded-2xl px-6 py-3 flex items-center gap-2 border border-tg-blue/30 text-tg-blue-light font-semibold text-sm"
            >
              <span>📖</span>
              <span>{t('splash.howToPlay')}</span>
            </button>
          </>
        ) : (
          <div className="w-full flex flex-col gap-3 animate-slide-up">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-1"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {HOW_TO_CARDS.map((card, i) => (
                <div key={card.title} className="snap-center flex-shrink-0 w-full">
                  <HowToPlayCard card={card} index={i} active={activeCard === i} />
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-1.5">
              {HOW_TO_CARDS.map((card, i) => (
                <div
                  key={card.title}
                  className="rounded-full transition-all duration-300"
                  style={{
                    width: activeCard === i ? 18 : 6,
                    height: 6,
                    background: activeCard === i ? 'var(--tg-blue)' : 'var(--tg-fill-3)',
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        className="relative w-full px-6 pb-4 flex flex-col gap-3 animate-slide-up"
        style={{ animationDelay: '0.3s' }}
      >
        <button
          onClick={onPlay}
          className="tappable w-full py-4 rounded-2xl font-bold text-lg relative overflow-hidden glow-blue"
          style={{
            background: 'linear-gradient(135deg, var(--tg-blue) 0%, var(--tg-blue-dark) 100%)',
            color: 'var(--tg-on-accent)',
          }}
        >
          <span className="relative z-10">{t('splash.play')}</span>
        </button>
        {showHowTo && (
          <button onClick={() => setShowHowTo(false)} className="tappable text-tg-subtext text-sm text-center">
            {t('common.back')}
          </button>
        )}
        <p className="text-center text-tg-subtext text-xs opacity-60">
          {t('splash.version', { version: APP_VERSION })}
        </p>
      </div>
    </div>
  )
}
