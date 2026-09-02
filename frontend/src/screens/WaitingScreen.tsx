import { useEffect, useState } from 'react'
import { useAppChrome } from '../components/AppMenu'
import { useI18n, useT } from '../i18n'
import { formatRounds } from '../lib/format'
import { ECONOMY } from '../config/economy'
import { buildInviteMessage, buildInviteUrl } from '../lib/invite'
import { shareLink } from '../telegram/sdk'

export function WaitingScreen({
  onCancel,
  bet,
  rounds,
  condition,
  onShare,
  onLeaveWaiting,
  inviteStartParam,
  highlightShare,
}: {
  onCancel: () => void
  bet: number
  rounds: number
  /** Условие пари — оно должно попасть и в сообщение другу. */
  condition?: string
  /** Отправка через родное окно Telegram. Если не передана — обычная ссылка. */
  onShare?: () => void
  /**
   * Человек шёл именно звать друга.
   *
   * Тогда выбор друга — то, зачем он здесь, и кнопка должна выглядеть как
   * продолжение нажатия, а не как одна из равных возможностей. Открыть окно
   * само приложение не может: Telegram показывает список чатов только по
   * живому нажатию человека.
   */
  highlightShare?: boolean
  /** Уйти с экрана, не отменяя приглашение: оно живёт сутки. */
  onLeaveWaiting?: () => void
  /**
   * Матч с другом ждёт не случайного соперника, а конкретного человека
   * по ссылке. Тогда вместо «ищем соперника» показываем саму ссылку.
   */
  inviteStartParam?: string | null
}) {
  const t = useT()
  const { lang } = useI18n()
  const { topBar, menu } = useAppChrome()
  const [dots, setDots] = useState(0)
  const [copied, setCopied] = useState(false)

  const inviteUrl = inviteStartParam
    ? buildInviteUrl(inviteStartParam)
    : null

  /*
   * И кнопка «отправить», и «скопировать» дают одно и то же готовое
   * сообщение: вызов, условие пари, ставка и раунды. Голая ссылка без
   * условия — это не то, ради чего человек писал другу.
   */
  const inviteMessage = buildInviteMessage(t, { bet, rounds, condition })

  useEffect(() => {
    const timer = setInterval(() => setDots((d) => (d + 1) % 4), 500)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-6">
      {topBar}
      {menu}

      <div className="pt-4">
        <div className="text-tg-subtext text-xs font-semibold uppercase tracking-widest text-center">
          {t('common.bet')} · {bet === ECONOMY.FREE_BET ? t('bet.free') : `${bet} 🪙`} ·{' '}
          {formatRounds(rounds, lang)}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 animate-fade-in">
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
            {inviteUrl ? t('waiting.invite.title') : t('waiting.searching')}
            {'.'.repeat(dots)}
          </h2>
          <p className="text-tg-subtext text-sm text-center max-w-xs">
            {inviteUrl ? t('waiting.invite.hint') : t('waiting.hint')}
          </p>
        </div>

        {inviteUrl && (
          <div className="w-full flex flex-col gap-2 animate-fade-in">
            {/*
              Сначала действие, потом ссылка.
              Человек пришёл сюда звать друга — выбор чата и есть следующий шаг,
              а ссылка нужна лишь тому, кто захочет отправить её сам.
            */}
            <button
              onClick={() => (onShare ? onShare() : shareLink(inviteUrl, inviteMessage))}
              className={
                highlightShare
                  ? 'tappable w-full py-4 rounded-2xl font-black text-white text-lg flex items-center justify-center gap-2 glow-blue'
                  : 'tappable w-full py-3.5 rounded-2xl font-bold text-tg-text glass-strong border border-tg-blue/40'
              }
              style={highlightShare ? { background: 'var(--tg-blue)' } : undefined}
            >
              {highlightShare && <span className="text-xl">👥</span>}
              {t('waiting.invite.share')}
            </button>
            <div className="glass rounded-2xl px-4 py-3 text-tg-subtext text-xs break-all text-center">
              {inviteUrl}
            </div>
            {/*
              Караулить экран не нужно: приглашение живёт сутки, и когда друг
              зайдёт, придёт окно «играем?». Раньше выход отсюда засчитывался
              брошенным матчем — за это и держали человека на экране.
            */}
            {onLeaveWaiting && (
              <p className="text-tg-subtext text-xs text-center leading-relaxed px-2">
                {t('waiting.canLeave')}
              </p>
            )}
            <button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${inviteMessage}\n${inviteUrl}`)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }}
              className="tappable w-full py-3 rounded-2xl font-semibold text-tg-subtext glass border border-tg-border"
            >
              {copied ? t('waiting.invite.copied') : t('waiting.invite.copy')}
            </button>
            {onLeaveWaiting && (
              <button
                onClick={onLeaveWaiting}
                className="tappable w-full py-3 rounded-2xl font-semibold text-tg-blue-light"
              >
                {t('waiting.leaveButton')}
              </button>
            )}
          </div>
        )}
        {/*
          Правка 12: плитки «142 в поиске» и «~8s среднее время» убраны.
          На старте эти цифры были бы выдуманными.
        */}
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
