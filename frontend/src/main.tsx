import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme/ThemeProvider'
import { AppStateProvider } from './state/AppState'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
