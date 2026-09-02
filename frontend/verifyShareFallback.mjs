/*
 * Проверка отправки приглашения на разных клиентах Telegram.
 *
 * Клиент для macOS команду «покажи список чатов» принимает молча: окна не
 * открывает и ответа не шлёт. Приложение при этом считало, что всё удалось,
 * и человек оставался ни с чем. Хуже того, внутри telegram-web-app.js есть
 * засов: он взводится перед показом окна и снимается только ответом клиента.
 * Без ответа он остаётся взведённым, и каждая следующая попытка падает с
 * WebAppShareMessageOpened — ровно это и было видно в жалобе.
 *
 * Здесь проверяется настоящий модуль из src/telegram/sdk.ts, а не его пересказ:
 * он собирается esbuild-ом и исполняется в браузере рядом с поддельным
 * Telegram — сначала молчаливым, потом нормальным.
 *
 * Запуск: node verifyShareFallback.mjs
 */

import { createRequire } from 'node:module'

/** Playwright может стоять и рядом с проектом, и глобально — ищем в обоих местах. */
const require_ = createRequire(import.meta.url)
const { chromium } = (() => {
  for (const where of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright']) {
    try {
      return require_(where)
    } catch {
      /* пробуем следующее место */
    }
  }
  console.error('Нужен playwright: npm i -D playwright')
  process.exit(1)
})()
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'

let passed = 0
let failed = 0

function check(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
    failed++
  }
}

// Настоящий модуль приложения, собранный в один файл для браузера.
const BUNDLE = '/tmp/knb-sdk.js'
execFileSync('node_modules/.bin/esbuild', [
  'src/telegram/sdk.ts',
  '--bundle',
  '--format=iife',
  '--global-name=SDK',
  `--outfile=${BUNDLE}`,
  '--log-level=warning',
])
const sdkSource = readFileSync(BUNDLE, 'utf8')

/**
 * Поддельный Telegram с настоящим засовом из telegram-web-app.js.
 *
 * 'silent' — клиент как на macOS: команду глотает, ответа нет, окна нет.
 * 'opens'  — клиент как на телефоне: окно показывает и забирает фокус.
 */
function fakeTelegram(mode) {
  return `
    window.__calls = { share: 0, link: 0, opened: false }
    window.TelegramWebviewProxy = { postEvent: () => {} }
    let latch = false
    window.Telegram = { WebApp: {
      initData: '',
      initDataUnsafe: {},
      version: '9.6',
      platform: '${mode === 'silent' ? 'macos' : 'ios'}',
      colorScheme: 'light',
      ready: () => {}, expand: () => {},
      isVersionAtLeast: () => true,
      shareMessage: (id, cb) => {
        window.__calls.share++
        if (latch) throw new Error('WebAppShareMessageOpened')
        latch = true
        ${
          mode === 'opens'
            ? `window.__calls.opened = true
               document.hasFocus = () => false
               setTimeout(() => { latch = false; cb && cb(true) }, 300)`
            : `/* молчание: ни ответа, ни окна */`
        }
      },
      openTelegramLink: () => { window.__calls.link++ },
      openLink: () => { window.__calls.link++ },
      HapticFeedback: { impactOccurred(){}, notificationOccurred(){}, selectionChanged(){} },
    } }
  `
}

async function probe(mode) {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.addInitScript(fakeTelegram(mode))
  await page.goto('about:blank')
  await page.addScriptTag({ content: sdkSource })

  const result = await page.evaluate(async () => {
    /*
     * Повторяем то, что делает экран по нажатию: сообщение уже готово,
     * поэтому просьба уходит сразу, без единого ожидания. Замеряем, сколько
     * «тиков» прошло между нажатием и просьбой — их должно быть ноль.
     */
    function press(id) {
      const before = window.__calls.share
      let awaited = false
      queueMicrotask(() => { awaited = true })
      const started = window.SDK.chatPickerBroken()
        ? { ok: false }
        : window.SDK.sharePreparedMessage(id)
      return {
        started,
        // true означало бы, что между нажатием и просьбой успел
        // прокрутиться цикл событий — для Telegram это уже не нажатие.
        deferred: awaited,
        called: window.__calls.share > before,
      }
    }

    const first = press('prep_123')
    let firstOpened = false
    if (first.started.ok) {
      firstOpened = await window.SDK.confirmChatPicker()
      if (!firstOpened) window.SDK.shareLink('https://t.me/bot?startapp=match_1', 'вызов')
    } else {
      window.SDK.shareLink('https://t.me/bot?startapp=match_1', 'вызов')
    }

    const second = press('prep_456')
    let secondOpened = false
    if (second.started.ok) {
      secondOpened = await window.SDK.confirmChatPicker()
      if (!secondOpened) window.SDK.shareLink('https://t.me/bot?startapp=match_1', 'вызов')
    } else {
      window.SDK.shareLink('https://t.me/bot?startapp=match_1', 'вызов')
    }

    return {
      firstOpened,
      secondOpened,
      firstSync: first.called && !first.deferred,
      secondCalled: second.called,
      broken: window.SDK.chatPickerBroken(),
      calls: window.__calls,
      diagnostics: window.SDK.telegramDiagnostics(),
    }
  })

  await browser.close()
  return result
}

console.log('\nКлиент, который молча глотает команду (macOS)')
const silent = await probe('silent')
check(silent.firstSync, 'просьба ушла в тот же миг, что и нажатие — без ожиданий')
check(silent.firstOpened === false, 'молчание замечено — окно не открылось')
check(silent.calls.link === 2, 'оба раза человек получил родное окно запасным путём', silent.calls)
check(silent.secondCalled === false, 'во второй раз в закрытую дверь не стучимся', silent.calls)
check(silent.broken === true, 'клиент помечен как неспособный показать окно')
check(
  silent.diagnostics.includes('macos') && silent.diagnostics.includes('связь: телефон'),
  'диагностика называет платформу и канал связи',
  silent.diagnostics,
)

console.log('\nКлиент, который окно показывает (телефон)')
const opens = await probe('opens')
check(opens.firstSync, 'просьба ушла в тот же миг, что и нажатие — без ожиданий')
check(opens.firstOpened === true, 'окно открылось')
check(opens.calls.opened === true, 'команда дошла до клиента')
check(opens.calls.link === 0, 'запасной путь не полез поверх открытого окна', opens.calls)
check(opens.secondOpened === true, 'второе приглашение тоже открылось')
check(opens.calls.share === 2, 'засов снялся ответом клиента', opens.calls)
check(opens.broken === false, 'рабочий клиент не помечен как сломанный')

rmSync(BUNDLE, { force: true })
console.log(`\nИтог: ${passed} прошло, ${failed} не прошло`)
process.exit(failed === 0 ? 0 : 1)
