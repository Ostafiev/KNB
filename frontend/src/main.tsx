import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme/ThemeProvider'
import { AppStateProvider } from './state/AppState'
import { LiveMatchProvider } from './state/LiveMatch'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AppStateProvider>
          <LiveMatchProvider>
            <App />
          </LiveMatchProvider>
        </AppStateProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
