import { useEffect, useState } from 'react'
import { useAppChrome } from '../components/AppMenu'
import { useI18n, useT } from '../i18n'
import { formatRounds } from '../lib/format'
import { ECONOMY } from '../config/economy'
import { buildInviteMessage, buildInviteUrl, buildShareHref } from '../lib/invite'

export function WaitingScreen({
  onCancel,
  bet,
  rounds,
  condition,
  onLeaveWaiting,
  inviteStartParam,
  highlightShare,
}: {
  onCancel: () => void
  bet: number
  rounds: number
  /** Условие пари — оно должно попасть и в сообщение другу. */
  condition?: string
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

  /**
   * Адрес, по которому Telegram сам открывает окно «Выберите чаты».
   *
   * Текст и ссылка уходят в сообщение готовыми — другу приходит вызов
   * с условием пари, а не голый адрес.
   */
  const shareHref = inviteUrl ? buildShareHref(inviteUrl, inviteMessage) : ''

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
              Обычная ссылка, а не команда Telegram.
              ────────────────────────────────────
              Долго не работал «правильный» путь: приложение просило клиент
              показать список чатов, а тот молчал — ни окна, ни отказа. Разбор
              упирался в то, что ответа нет вовсе.

              Здесь ничего просить не нужно. Это обычная ссылка на t.me,
              а Telegram сам перехватывает такие ссылки внутри приложения и
              показывает своё окно «Выберите чаты». Работает во всех клиентах
              и не зависит ни от версии, ни от связи со страницей: нажатие на
              ссылку — это нажатие, а не просьба.
            */}
            <a
              href={shareHref}
              className={
                highlightShare
                  ? 'tappable w-full py-4 rounded-2xl font-black text-white text-lg flex items-center justify-center gap-2 glow-blue'
                  : 'tappable w-full py-3.5 rounded-2xl font-bold text-tg-text glass-strong border border-tg-blue/40 flex items-center justify-center'
              }
              style={highlightShare ? { background: 'var(--tg-blue)' } : undefined}
            >
              {highlightShare && <span className="text-xl">👥</span>}
              {t('waiting.invite.share')}
            </a>

            {/*
              Ссылка и копирование — одной строкой.
              Отдельная кнопка «Скопировать ссылку» занимала целую полосу ради
              действия, которому хватает значка. Экран был из пяти кнопок
              подряд, и главная терялась среди равных.
            */}
            <div className="glass rounded-2xl pl-4 pr-2 py-2 flex items-center gap-2">
              <span className="flex-1 min-w-0 text-tg-subtext text-xs truncate">{inviteUrl}</span>
              <button
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(`${inviteMessage}\n${inviteUrl}`)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
                }}
                aria-label={t('waiting.invite.copy')}
                className="tappable rounded-xl w-9 h-9 flex items-center justify-center text-base flex-shrink-0"
                style={{ background: 'var(--tg-fill)' }}
              >
                {copied ? '✓' : '⧉'}
              </button>
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
          </div>
        )}
        {/*
          Правка 12: плитки «142 в поиске» и «~8s среднее время» убраны.
          На старте эти цифры были бы выдуманными.
        */}
      </div>

      {/*
        Внизу — два разных решения, и выглядеть они должны по-разному.
        «Свернуть» человек нажимает часто: бой остаётся ждать, и вернуться к
        нему можно с главной. «Отменить» — редкое и необратимое, поэтому оно
        не кнопка во всю ширину, а спокойная строчка под ней.
      */}
      <div className="w-full pb-4 flex flex-col gap-1">
        {onLeaveWaiting && (
          <button
            onClick={onLeaveWaiting}
            className="tappable w-full py-4 rounded-2xl font-bold text-tg-text glass border border-tg-border"
          >
            {t('waiting.leaveButton')}
          </button>
        )}
        <button
          onClick={onCancel}
          className={
            onLeaveWaiting
              ? 'tappable w-full py-3 rounded-2xl text-sm font-semibold text-tg-red'
              : 'tappable w-full py-4 rounded-2xl font-bold text-tg-red glass border border-tg-red/30'
          }
        >
          {t('waiting.cancel')}
        </button>
      </div>
    </div>
  )
}
