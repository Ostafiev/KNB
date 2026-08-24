import type { Screen } from '../types'
import { useTheme } from '../theme/ThemeProvider'
import { useI18n } from '../i18n'

/**
 * ЧАСТЬ 2, п.8 — панель быстрого перехода между экранами.
 *
 * Рендерится только в DEV-сборке (см. SHOW_DEV_BAR в src/config/env.ts).
 * В PROD её место занимает обычный хедер с кнопкой меню внутри HomeScreen.
 */

export const SCREEN_ORDER: Screen[] = [
  'splash',
  'consent',
  'home',
  'opponents',
  'create',
  'waiting',
  'battle',
  'result',
  'summary',
]

const SCREEN_LABELS: Record<Screen, string> = {
  splash: 'Заставка',
  consent: 'Согласие',
  home: 'Главная',
  opponents: 'Соперники',
  create: 'Создать игру',
  waiting: 'Ожидание',
  battle: 'Бой',
  result: 'Результат',
  summary: 'Итоги',
}

export const DEV_BAR_HEIGHT = 34

export function DevBar({ screen, onGo }: { screen: Screen; onGo: (screen: Screen) => void }) {
  const { theme, toggleTheme } = useTheme()
  const { lang, setLang } = useI18n()

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto"
      style={{
        background: 'var(--tg-bg)',
        borderBottom: '1px solid var(--tg-border)',
        height: DEV_BAR_HEIGHT,
      }}
    >
      {SCREEN_ORDER.map((s, i) => (
        <button
          key={s}
          onClick={() => onGo(s)}
          title={SCREEN_LABELS[s]}
          className="tappable flex-shrink-0 rounded-lg px-2 py-1 text-xs font-medium transition-all duration-150"
          style={{
            background: screen === s ? 'var(--tg-blue)' : 'var(--tg-fill)',
            color: screen === s ? 'var(--tg-on-accent)' : 'var(--tg-subtext)',
          }}
        >
          {i + 1}
        </button>
      ))}
      <span className="text-tg-subtext text-xs ml-1 flex-shrink-0 truncate max-w-24">
        {SCREEN_LABELS[screen]}
      </span>

      {/* Быстрые переключатели для ручной проверки темы и языка */}
      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={toggleTheme}
          title="Переключить тему"
          className="tappable rounded-lg px-2 py-1 text-xs"
          style={{ background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }}
        >
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>
        <button
          onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          title="Переключить язык"
          className="tappable rounded-lg px-2 py-1 text-xs font-bold"
          style={{ background: 'var(--tg-fill)', color: 'var(--tg-subtext)' }}
        >
          {lang.toUpperCase()}
        </button>
      </div>
    </div>
  )
}
