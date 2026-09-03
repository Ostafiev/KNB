import { useState } from 'react'
import { PrimaryButton } from '../components/ui'
import { useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { api } from '../api/client'
import { AVATARS } from '../data/mock'
import { hapticNotify, hapticSelection } from '../telegram/sdk'

/**
 * Знакомство — один раз, при первом входе.
 *
 * До сих пор имя подставлялось из Telegram молча, и человек узнавал об этом,
 * только увидев себя в списке соперников. Не всякий хочет светить настоящее
 * имя в игре на ставки, поэтому спрашиваем сразу — но не заставляем: имя из
 * Telegram уже вписано, и можно просто нажать «Готово».
 */
export function NameScreen({ onDone }: { onDone: () => void }) {
  const t = useT()
  const { nickname, avatarId, setNickname, setAvatar } = useAppState()

  const [draft, setDraft] = useState(nickname)
  const [suggesting, setSuggesting] = useState(false)
  const trimmed = draft.trim()
  const tooShort = trimmed.length < 2

  /**
   * Ник придумывает сервер — там же, где придумываются ники ботам.
   *
   * Один список на всех не случайность: если бы игроки подписывались иначе,
   * чем боты, обе стороны было бы видно насквозь.
   */
  const suggest = async (): Promise<void> => {
    setSuggesting(true)
    try {
      const { nickname: suggested } = await api.suggestNickname()
      setDraft(suggested)
    } catch {
      // Сервер недоступен — человек всегда может вписать своё.
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-5">
      <div className="flex-1 flex flex-col justify-center gap-6 py-8 animate-fade-in">
        <div className="text-center">
          <div className="text-5xl mb-3">👋</div>
          <h1 className="text-2xl font-black text-tg-text">{t('name.title')}</h1>
          <p className="text-tg-subtext text-sm mt-1.5 leading-relaxed">{t('name.subtitle')}</p>
        </div>

        <div className="glass rounded-2xl p-4 flex flex-col gap-3">
          <label className="text-tg-subtext text-xs font-semibold uppercase tracking-wider">
            {t('name.label')}
          </label>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 24))}
            maxLength={24}
            autoComplete="off"
            className="w-full bg-transparent text-tg-text text-lg font-bold outline-none border-b pb-2"
            style={{ borderColor: 'var(--tg-border)' }}
            placeholder={t('name.placeholder')}
          />
          {/*
            Придумать ник за человека.
            Выбор был между настоящим именем и придумыванием на месте, а
            придумывать на входе никто не любит — и большинство оставляло имя
            из Telegram, даже если не хотело его светить.
          */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                hapticSelection()
                void suggest()
              }}
              disabled={suggesting}
              className="tappable rounded-xl px-3 py-1.5 text-xs font-bold text-tg-blue-light glass border border-tg-blue/30"
              style={{ opacity: suggesting ? 0.5 : 1 }}
            >
              🎲 {t('name.suggest')}
            </button>
            <span className="text-tg-subtext text-xs">{trimmed.length}/24</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-4 flex flex-col gap-3">
          <span className="text-tg-subtext text-xs font-semibold uppercase tracking-wider">
            {t('name.avatar')}
          </span>
          <div className="grid grid-cols-8 gap-1.5">
            {AVATARS.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  hapticSelection()
                  setAvatar(option.id)
                }}
                aria-label={option.id}
                className="tappable aspect-square rounded-xl flex items-center justify-center text-lg transition-all duration-150"
                style={{
                  background: avatarId === option.id ? 'var(--tg-blue)' : 'var(--tg-fill)',
                  border:
                    avatarId === option.id ? '1px solid var(--tg-blue)' : '1px solid transparent',
                }}
              >
                {option.emoji}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pb-4">
        <PrimaryButton
          variant="green"
          disabled={tooShort}
          onClick={() => {
            if (tooShort) return
            if (trimmed !== nickname) setNickname(trimmed)
            hapticNotify('success')
            onDone()
          }}
        >
          {t('name.done')}
        </PrimaryButton>
        <p className="text-center text-tg-subtext text-xs">{t('name.hint')}</p>
      </div>
    </div>
  )
}
