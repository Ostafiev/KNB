import { useState } from 'react'
import { useT } from '../i18n'
import { PrimaryButton } from '../components/ui'
import { hapticNotify, hapticSelection } from '../telegram/sdk'

/**
 * ЧАСТЬ 2, п.13 — экран согласия пользователя.
 *
 * Показывается один раз при первом входе; факт согласия хранится в состоянии
 * приложения (consentAccepted).
 * TODO(backend): дублировать флаг на сервере (users.consent_accepted_at), чтобы
 * согласие переживало смену устройства и очистку localStorage.
 */
export function ConsentScreen({ onAccept }: { onAccept: () => void }) {
  const t = useT()
  const [checked, setChecked] = useState(false)

  const blocks = [
    { icon: '🔞', title: t('consent.age.title'), body: t('consent.age.body') },
    { icon: '📄', title: t('consent.terms.title'), body: t('consent.terms.body') },
  ]

  /*
   * Про программу-соперника здесь больше не пишем: экран согласия и так
   * встречает человека стеной текста до первой игры. Это осталось
   * в условиях использования, куда ведёт ссылка ниже.
   */

  return (
    <div className="flex flex-col min-h-screen mesh-bg safe-top safe-bottom px-5">
      <div className="flex-1 flex flex-col justify-center gap-5 py-8 animate-fade-in">
        <div className="text-center">
          <div className="text-5xl mb-3">🤝</div>
          <h1 className="text-2xl font-black text-tg-text">{t('consent.title')}</h1>
          <p className="text-tg-subtext text-sm mt-1.5">{t('consent.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3">
          {blocks.map((block) => (
            <div key={block.title} className="glass rounded-2xl p-4 flex gap-3">
              <span className="text-2xl flex-shrink-0">{block.icon}</span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-tg-text">{block.title}</div>
                <p className="text-tg-subtext text-xs leading-relaxed mt-0.5">{block.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* TODO(legal): подставить реальные URL документов */}
        <div className="flex flex-col gap-1.5 px-1">
          <a
            href="#terms"
            className="text-tg-blue-light text-xs font-semibold"
            onClick={(e) => e.preventDefault()}
          >
            → {t('consent.terms.link')}
          </a>
          <a
            href="#privacy"
            className="text-tg-blue-light text-xs font-semibold"
            onClick={(e) => e.preventDefault()}
          >
            → {t('consent.privacy.link')}
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3 pb-4">
        <button
          onClick={() => {
            hapticSelection()
            setChecked((v) => !v)
          }}
          className="tappable glass rounded-2xl p-4 flex items-start gap-3 text-left"
          style={{ border: checked ? '1px solid var(--tg-green)' : '1px solid var(--tg-border)' }}
        >
          <span
            className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5 transition-all duration-150"
            style={{
              background: checked ? 'var(--tg-green)' : 'transparent',
              border: checked ? '1px solid var(--tg-green)' : '1px solid var(--tg-fill-3)',
              color: 'var(--tg-on-accent)',
            }}
            role="checkbox"
            aria-checked={checked}
          >
            {checked ? '✓' : ''}
          </span>
          <span className="text-tg-text text-sm leading-snug">{t('consent.checkbox')}</span>
        </button>

        <PrimaryButton
          variant="green"
          disabled={!checked}
          onClick={() => {
            if (!checked) return
            hapticNotify('success')
            onAccept()
          }}
        >
          {t('consent.accept')}
        </PrimaryButton>

        <p className="text-center text-tg-subtext text-xs">{t('consent.hint')}</p>
      </div>
    </div>
  )
}
