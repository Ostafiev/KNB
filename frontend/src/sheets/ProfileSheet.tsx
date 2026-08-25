import { useState } from 'react'
import { BottomSheet, SheetRow, SheetDivider } from '../components/BottomSheet'
import { Toggle } from '../components/ui'
import { useI18n, useT } from '../i18n'
import { useTheme } from '../theme/ThemeProvider'
import { useAppState } from '../state/AppState'
import { AVATARS } from '../data/mock'
import type { Lang } from '../types'

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { lang, isAuto, setLang } = useI18n()
  const { isDark, setTheme } = useTheme()
  const {
    nickname,
    avatar,
    avatarId,
    telegramUsername,
    telegramId,
    soundEnabled,
    setSoundEnabled,
    setNickname,
    setAvatar,
  } = useAppState()

  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(nickname)

  const saveProfile = () => {
    const trimmed = draftName.trim()
    if (trimmed) setNickname(trimmed)
    setEditing(false)
  }

  return (
    <BottomSheet open onClose={onClose}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-12 h-12 rounded-2xl glass-strong flex items-center justify-center text-2xl flex-shrink-0">
          {avatar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-black text-tg-text truncate">{nickname}</div>
          <div className="text-tg-subtext text-xs truncate">@{telegramUsername} · ID {telegramId}</div>
        </div>
        <button
          onClick={() => {
            setDraftName(nickname)
            setEditing((v) => !v)
          }}
          className="tappable glass rounded-xl px-2.5 py-1 text-xs text-tg-blue-light border border-tg-blue/30 flex-shrink-0"
        >
          {t('profile.edit')}
        </button>
      </div>

      {/* Редактирование ника и аватара — шаг онбординга из ЧАСТИ 3, п.7 */}
      {editing && (
        <div className="glass rounded-2xl p-4 flex flex-col gap-3 animate-slide-up">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={24}
            className="w-full bg-transparent text-tg-text text-sm outline-none border-b pb-2"
            style={{ borderColor: 'var(--tg-border)' }}
            placeholder={nickname}
          />
          <div className="grid grid-cols-8 gap-1.5">
            {AVATARS.map((option) => (
              <button
                key={option.id}
                onClick={() => setAvatar(option.id)}
                className="tappable aspect-square rounded-xl flex items-center justify-center text-lg transition-all duration-150"
                style={{
                  background: avatarId === option.id ? 'var(--tg-blue)' : 'var(--tg-fill)',
                  border: avatarId === option.id ? '1px solid var(--tg-blue)' : '1px solid transparent',
                }}
              >
                {option.emoji}
              </button>
            ))}
          </div>
          <button
            onClick={saveProfile}
            className="tappable rounded-xl py-2.5 text-sm font-bold"
            style={{ background: 'var(--tg-blue)', color: 'var(--tg-on-accent)' }}
          >
            OK
          </button>
        </div>
      )}

      <SheetDivider />

      {/* Язык — ЧАСТЬ 2, п.12: определяется автоматически, меняется вручную */}
      <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-xl">🌐</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-tg-text">{t('profile.language')}</div>
          {isAuto && <div className="text-tg-subtext text-xs">{t('profile.language.auto')}</div>}
        </div>
        <div className="glass rounded-xl flex overflow-hidden flex-shrink-0">
          {(['ru', 'en'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className="tappable px-3 py-1 text-xs font-bold transition-all duration-150"
              style={{
                background: lang === l ? 'var(--tg-blue)' : 'transparent',
                color: lang === l ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Тема — ЧАСТЬ 2, п.4 */}
      <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-xl">{isDark ? '🌙' : '☀️'}</span>
        <span className="text-sm font-semibold text-tg-text flex-1">{t('profile.theme')}</span>
        <Toggle checked={isDark} onChange={(next) => setTheme(next ? 'dark' : 'light')} label={t('profile.theme')} />
      </div>

      <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-xl">{soundEnabled ? '🔊' : '🔇'}</span>
        <span className="text-sm font-semibold text-tg-text flex-1">{t('profile.sound')}</span>
        <Toggle
          checked={soundEnabled}
          onChange={setSoundEnabled}
          accent="var(--tg-green)"
          label={t('profile.sound')}
        />
      </div>

      <SheetDivider />

      {/* TODO(backend): открыть реальные экраны истории и кошелька (TON Connect — ЧАСТЬ 3, этап 3) */}
      <SheetRow icon="📋" label={t('profile.transactions')} sublabel={t('profile.transactions.sub')} onClick={onClose} />
      <SheetRow icon="💳" label={t('profile.wallet')} sublabel={t('profile.wallet.sub')} onClick={onClose} />
    </BottomSheet>
  )
}
