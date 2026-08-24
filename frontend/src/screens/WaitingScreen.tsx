import { useEffect, useState } from 'react'
import { useT } from '../i18n'

export function WaitingScreen({
  onCancel,
  bet,
  rounds,
}: {
  onCancel: () => void
  bet: number
  rounds: number
}) {
  const t = useT()
  const [dots, setDots] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setDots((d) => (d + 1) % 4), 500)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom items-center justify-between px-6">
      <div className="pt-6">
        <div className="text-tg-subtext text-xs font-semibold uppercase tracking-widest text-center">
          {t('common.bet')} · {bet} 🪙 · {rounds} {t('common.rounds')}
        </div>
      </div>

      <div className="flex flex-col items-center gap-8 animate-fade-in">
        <div className="relative flex items-center justify-center w-48 h-48">
          {[1, 2, 3].map((ring) => (
            <div
              key={ring}
              className="absolute rounded-full border border-tg-blue/30"
              style={{
                width: `${ring * 56}px`,
                height: `${ring * 56}px`,
                animation: `pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) ${ring * 0.3}s infinite`,
              }}
            />
          ))}
          <div className="relative z-10 w-20 h-20 rounded-full glass-strong flex items-center justify-center text-4xl animate-pulse-core glow-blue">
            ⏳
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h2 className="text-2xl font-black text-tg-text text-center">
            {t('waiting.searching')}
            {'.'.repeat(dots)}
          </h2>
          <p className="text-tg-subtext text-sm text-center max-w-xs">{t('waiting.hint')}</p>
        </div>

        {/* TODO(backend): реальные цифры очереди из Redis-матчмейкинга (ЧАСТЬ 3) */}
        <div className="flex gap-3">
          <div className="glass rounded-xl px-4 py-3 text-center">
            <div className="text-tg-blue-light font-bold text-lg">142</div>
            <div className="text-tg-subtext text-xs">{t('waiting.inSearch')}</div>
          </div>
          <div className="glass rounded-xl px-4 py-3 text-center">
            <div className="text-tg-green font-bold text-lg">~8s</div>
            <div className="text-tg-subtext text-xs">{t('waiting.avgTime')}</div>
          </div>
        </div>
      </div>

      <div className="w-full pb-4">
        <button
          onClick={onCancel}
          className="tappable w-full py-4 rounded-2xl font-bold text-tg-red glass border border-tg-red/30"
        >
          {t('waiting.cancel')}
        </button>
      </div>
    </div>
  )
}
