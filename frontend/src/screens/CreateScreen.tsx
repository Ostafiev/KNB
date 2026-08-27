import { useState } from 'react'
import { ScreenHeader, PrimaryButton, GhostButton } from '../components/ui'
import { useAppChrome } from '../components/AppMenu'
import { BetSlider, RoundsPicker } from '../components/BetControls'
import { useI18n, useT } from '../i18n'
import { formatRounds } from '../lib/format'
import { ECONOMY } from '../config/economy'
import { hapticSelection } from '../telegram/sdk'
import type { MatchConfig, MatchMode } from '../types'

export function CreateScreen({
  onCreate,
  onBack,
}: {
  onCreate: (config: MatchConfig, options?: { share?: boolean }) => void
  onBack: () => void
}) {
  const t = useT()
  const { lang } = useI18n()
  const { topBar, menu } = useAppChrome()
  const [mode, setMode] = useState<MatchMode>('random')
  const [bet, setBet] = useState(100)
  const [rounds, setRounds] = useState(3)
  const [condition, setCondition] = useState('')

  /**
   * ЧАСТЬ 2, п.11 — текстовые условия пари только в игре с друзьями.
   * В случайном матчмейкинге поле скрыто, а само значение не попадает в конфиг.
   */
  const conditionAllowed = mode === 'friend'
  const effectiveCondition = conditionAllowed ? condition.trim() : ''

  const buildConfig = (): MatchConfig => ({
    mode,
    bet,
    roundsTotal: rounds,
    condition: effectiveCondition,
    opponentName: '',
    opponentAvatar: '👤',
    opponentRating: 1000,
  })

  /*
   * Приглашение другу: сначала заводим настоящий матч, и только потом
   * отправляем ссылку. Раньше здесь собиралась ссылка со случайными буквами —
   * друг открывал её и не находил за ней никакого боя.
   */
  const invite = (): void => onCreate(buildConfig(), { share: true })

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-4">
      {topBar}
      {menu}
      <ScreenHeader title={t('create.title')} onBack={onBack} />

      <div className="flex flex-col gap-4 animate-fade-in pb-4">
        {/* Режим матча */}
        <div className="glass rounded-3xl p-4">
          <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
            {t('create.mode')}
          </div>
          <div className="glass rounded-2xl p-1 flex gap-1">
            {(['random', 'friend'] as MatchMode[]).map((key) => (
              <button
                key={key}
                onClick={() => {
                  hapticSelection()
                  setMode(key)
                  // Ставка 0 разрешена только с другом — при возврате
                  // в случайный матч поднимаем её до минимальной (правка 20).
                  if (key === 'random' && bet < ECONOMY.MIN_BET) setBet(ECONOMY.MIN_BET)
                }}
                className="tappable flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                style={{
                  background: mode === key ? 'var(--tg-blue)' : 'transparent',
                  color: mode === key ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
                }}
              >
                {key === 'random' ? t('create.mode.random') : t('create.mode.friend')}
              </button>
            ))}
          </div>
        </div>

        {/* Ставка */}
        <div className="glass rounded-3xl p-5">
          <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-4">
            {t('create.stake')}
          </div>
          <BetSlider value={bet} onChange={setBet} allowFree={mode === 'friend'} />
        </div>

        {/* Раунды */}
        <div className="glass rounded-3xl p-5">
          <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
            {t('create.rounds')}
          </div>
          <RoundsPicker value={rounds} onChange={setRounds} />
        </div>

        {/* Условие пари — только для режима «с другом» */}
        {conditionAllowed ? (
          <div className="glass rounded-3xl p-5 animate-slide-up">
            <div className="text-tg-subtext text-xs font-semibold uppercase tracking-wider mb-3">
              {t('create.condition')}
            </div>
            <textarea
              value={condition}
              onChange={(e) => setCondition(e.target.value.slice(0, 200))}
              placeholder={t('create.condition.placeholder')}
              rows={3}
              className="w-full bg-transparent text-tg-text text-sm outline-none resize-none placeholder:text-tg-subtext/50 leading-relaxed"
            />
            {condition.length > 0 && (
              <div className="mt-2 text-tg-subtext text-xs text-right">{condition.length}/200</div>
            )}
          </div>
        ) : (
          <div className="glass rounded-2xl p-4 flex gap-3 items-start">
            <span className="text-lg flex-shrink-0">🛡️</span>
            <p className="text-tg-subtext text-xs leading-relaxed">{t('create.condition.randomNote')}</p>
          </div>
        )}

        {/* Итог */}
        <div className="glass rounded-2xl p-4 flex items-center gap-3 border border-tg-blue/20">
          <span className="text-xl flex-shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <div className="text-tg-subtext text-xs">{t('create.summary')}</div>
            <div className="text-sm font-bold text-tg-text">
              {bet === ECONOMY.FREE_BET ? t('bet.free') : `${bet} 🪙`} · {formatRounds(rounds, lang)} ·{' '}
              {effectiveCondition
                ? `"${effectiveCondition.slice(0, 30)}${effectiveCondition.length > 30 ? '…' : ''}"`
                : t('create.summary.noCondition')}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <PrimaryButton onClick={() => onCreate(buildConfig())}>
            <span className="text-xl">⚔️</span>
            <span>{t('create.submit')}</span>
          </PrimaryButton>
          {mode === 'friend' && (
            <>
              <GhostButton onClick={invite} tone="accent">
                📨 {t('invite.sendToFriend')}
              </GhostButton>
              <p className="text-center text-tg-subtext text-xs">{t('create.invite.note')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
