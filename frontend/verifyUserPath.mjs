/*
 * Пользовательский путь целиком — глазами человека, а не сервера.
 *
 * Остальные проверки говорят с сервером напрямую и поэтому не видят того,
 * что видит игрок: не тот экран, мёртвая кнопка, чужой итог. Здесь открывается
 * настоящее приложение в браузере и проходится тот же путь, по которому идёт
 * человек — с нажатиями, ожиданием и чтением того, что написано на экране.
 *
 * Каждый сценарий описан отдельно и падает сам по себе: если сломается один,
 * остальные всё равно пройдут и покажут, что цело.
 *
 * Перед запуском нужен поднятый сервер (npm run dev в backend) — он же отдаёт
 * собранное приложение. Сборку обновить: npm run build.
 *
 * Запуск: node verifyUserPath.mjs
 */

import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { chromium } = (() => {
  for (const where of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright']) {
    try {
      return require_(where)
    } catch {
      /* ищем дальше */
    }
  }
  console.error('Нужен playwright: npm i -D playwright')
  process.exit(1)
})()

const BASE = process.env.KNB_URL ?? 'http://127.0.0.1:3000'

let passed = 0
let failed = 0
const failures = []

function check(condition, label, detail) {
  if (condition) {
    console.log(`    ✓ ${label}`)
    passed++
  } else {
    console.log(`    ✗ ${label}`)
    if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`)
    failed++
    failures.push(label)
  }
}

async function scenario(title, fn) {
  console.log(`\n  ${title}`)
  try {
    await fn()
  } catch (error) {
    check(false, `сценарий оборвался: ${error.message}`)
  }
}

/** Свежий игрок в каждом прогоне: чужая история сбивает проверки. */
let slotCounter = Math.floor(Date.now() / 1000) % 100000

async function openApp(browser, { slot } = {}) {
  const context = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'ru-RU' })
  const page = await context.newPage()
  const devSlot = slot ?? ++slotCounter
  await page.goto(`${BASE}/?dev=${devSlot}`)
  await page.waitForLoadState('networkidle')
  return { context, page, devSlot }
}

/** Кнопка по видимому тексту — так же, как её ищет глазами человек. */
function byText(page, text) {
  return page.locator(`text=${text}`).first()
}

/**
 * Провести новичка до главной.
 *
 * Порядок экранов: заставка → согласие → знакомство. Каждый показывается
 * один раз, поэтому просто жмём то, что видим, пока не покажется главная.
 */
async function passOnboarding(page) {
  /*
   * Каждый шаг — один раз. Галочка согласия переключается, а не нажимается:
   * повторное нажатие снимало её обратно, и кнопка «Принимаю» так и не
   * становилась активной — проход ходил по кругу на том же экране.
   */
  const steps = ['Начать игру', 'Мне есть 18 лет', 'Принимаю и продолжаю', 'Готово']
  const done = new Set()

  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (await byText(page, 'Позвать в игру').isVisible().catch(() => false)) return
    let clicked = false
    for (const label of steps) {
      if (done.has(label)) continue
      const button = byText(page, label)
      if (await button.isVisible().catch(() => false)) {
        await button.click()
        done.add(label)
        await page.waitForTimeout(700)
        clicked = true
        break
      }
    }
    if (!clicked) await page.waitForTimeout(500)
  }
  // Не дошли до главной — показываем, где застряли, иначе разбирать нечего.
  const text = await page.locator('body').innerText()
  console.log(`        [застряли] ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
}

/*
 * Без прокси: приложение поднято рядом, на этой же машине, и обращаться к
 * нему через внешний прокси незачем — он до localhost всё равно не достучится.
 */
const browser = await chromium.launch({ args: ['--no-proxy-server'] })

// ─── 1. Первый вход ──────────────────────────────────────────────────────────

await scenario('Первый вход: согласие, имя, главная', async () => {
  const { context, page } = await openApp(browser)

  const splash = byText(page, 'Начать игру')
  check(await splash.isVisible().catch(() => false), 'новичка встречает заставка')
  await splash.click()
  await page.waitForTimeout(700)

  check(
    await byText(page, 'Прежде чем начать').isVisible().catch(() => false),
    'новому игроку показано согласие',
  )
  await byText(page, 'Мне есть 18 лет').click()
  await page.waitForTimeout(300)
  await byText(page, 'Принимаю и продолжаю').click()
  await page.waitForTimeout(900)

  const suggest = byText(page, 'Придумать ник')
  check(await suggest.isVisible().catch(() => false), 'на знакомстве есть «Придумать ник»')

  const input = page.locator('input').first()
  const before = await input.inputValue()
  await suggest.click()
  await page.waitForTimeout(800)
  const after = await input.inputValue()
  check(after !== before && after.length >= 2, 'ник подставился и отличается от имени', `${before} → ${after}`)
  check(/^[A-Za-z][A-Za-z0-9_]*$/.test(after), 'ник в общем стиле, без пробелов', after)

  await byText(page, 'Готово').click()
  await page.waitForTimeout(900)
  check(
    await byText(page, 'Играть').isVisible().catch(() => false),
    'после знакомства человек попадает на главную',
  )

  await context.close()
})

// ─── 2. Найти бой ────────────────────────────────────────────────────────────

await scenario('Найти бой: соперник находится и бой начинается', async () => {
  const { context, page } = await openApp(browser)
  await passOnboarding(page)

  await byText(page, 'Играть').click()
  await page.waitForTimeout(700)

  check(
    await byText(page, 'Создать свой бой').isVisible().catch(() => false),
    'на выборе соперника есть «Создать свой бой» — не нужно возвращаться на главную',
  )

  /*
   * Строка соперника — та, где написано «N раундов». Искать по слову
   * «раунд» нельзя: так же подписан фильтр «Любые раунды», а значок ⚡
   * есть и у вкладки «Случайный бой». Проверка тыкала в них и потом
   * жаловалась, что бой не начинается.
   */
  const rows = page.locator('button:has-text("раундов")')
  const count = await rows.count()
  check(count > 0, 'в списке есть открытые бои', `строк: ${count}`)

  const started = Date.now()
  await rows.first().click()

  // Экран боя узнаём по счёту раундов — он есть только там.
  await page
    .locator('text=Раунд 1/')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {})
  const elapsed = Date.now() - started
  const inBattle = await page.locator('text=Раунд 1/').first().isVisible().catch(() => false)
  check(inBattle, 'бой начался', `через ${(elapsed / 1000).toFixed(1)} с`)
  check(inBattle && elapsed <= 10_000, 'уложились в обещанные десять секунд', `${(elapsed / 1000).toFixed(1)} с`)

  await context.close()
})

// ─── 3. Позвать друга ────────────────────────────────────────────────────────

await scenario('Позвать друга: условия, ссылка, экран ожидания', async () => {
  const { context, page } = await openApp(browser)
  await passOnboarding(page)

  await byText(page, 'Позвать в игру').click()
  await page.waitForTimeout(600)

  const conditionField = page.locator('input, textarea').last()
  check(
    await conditionField.isVisible().catch(() => false),
    'сначала спрашивают условия пари, а не бросают в ожидание',
  )
  await conditionField.fill('кто проиграл — отжимается 10 раз')

  /*
   * Окно выбора чата открывает не приложение, а сам человек — кнопкой на
   * экране ожидания. Переход, сделанный страницей, Telegram показывает как
   * обычную веб-страницу t.me, а не как окно выбора чата: он считает
   * намерением только нажатие. Поэтому и проверяем нажатие.
   */
  let shareUrl = null
  await page.route('https://t.me/**', (route) => {
    shareUrl = route.request().url()
    return route.abort()
  })

  await byText(page, 'Отправить другу в Telegram').click()
  await page.waitForTimeout(2500)

  check(
    await byText(page, 'Ждём друга').isVisible().catch(() => false),
    'после отправки человек оказывается на экране ожидания',
  )

  await byText(page, 'Отправить в Telegram').click()
  await page.waitForTimeout(1500)

  check(shareUrl !== null, 'кнопка ведёт в Telegram, а не в никуда', shareUrl)
  if (shareUrl) {
    const parsed = new URL(shareUrl)
    check(parsed.pathname === '/share/url', 'открывается именно окно выбора чата', parsed.pathname)
    check(
      (parsed.searchParams.get('url') ?? '').includes('startapp=match_'),
      'в ссылке — приглашение на конкретный бой',
      parsed.searchParams.get('url'),
    )
    check(
      (parsed.searchParams.get('text') ?? '').includes('отжимается 10 раз'),
      'условие пари доехало до сообщения другу',
      parsed.searchParams.get('text'),
    )
  }

  await context.close()
})

// ─── 4. Свернуть и вернуться ─────────────────────────────────────────────────

await scenario('Свернуть ожидание и вернуться: проигрыша быть не должно', async () => {
  const { context, page } = await openApp(browser)
  await passOnboarding(page)

  await byText(page, 'Позвать в игру').click()
  await page.waitForTimeout(600)
  await page.route('https://t.me/**', (route) => route.abort())
  await byText(page, 'Отправить другу в Telegram').click()
  await page.waitForTimeout(2500)

  const waiting = await byText(page, 'Ждём друга').isVisible().catch(() => false)
  check(waiting, 'бой ждёт друга')

  await byText(page, 'Свернуть ожидание').click()
  await page.waitForTimeout(1200)

  check(
    await byText(page, 'Ждут друга').isVisible().catch(() => false),
    'свёрнутый бой виден на главной — не потерялся',
  )

  // Человек занимается своими делами.
  await page.waitForTimeout(8000)

  check(
    !(await byText(page, 'Поражение').isVisible().catch(() => false)) &&
      !(await byText(page, 'Проигрыш').isVisible().catch(() => false)),
    'никто не пришёл — и проигрыша ниоткуда не взялось',
  )

  await byText(page, 'Открыть').click()
  await page.waitForTimeout(1500)

  check(
    await byText(page, 'Ждём друга').isVisible().catch(() => false),
    'возврат к бою открывает ожидание, а не итоги',
  )
  check(
    !(await byText(page, 'Поражение').isVisible().catch(() => false)),
    'после возвращения не написано «поражение»',
  )

  await context.close()
})

// ─── 5. Друг заходит по ссылке ───────────────────────────────────────────────

await scenario('Друг открывает ссылку позже: обоих сводят вместе', async () => {
  const host = await openApp(browser)
  await passOnboarding(host.page)

  await byText(host.page, 'Позвать в игру').click()
  await host.page.waitForTimeout(600)

  let inviteParam = null
  await host.page.route('https://t.me/**', (route) => {
    const url = new URL(route.request().url())
    const target = url.searchParams.get('url') ?? ''
    const found = target.match(/startapp=(match_\d+)/)
    if (found) inviteParam = found[1]
    return route.abort()
  })
  await byText(host.page, 'Отправить другу в Telegram').click()
  await host.page.waitForTimeout(2500)
  await byText(host.page, 'Отправить в Telegram').click()
  await host.page.waitForTimeout(1500)
  check(inviteParam !== null, 'приглашение создано и в ссылке есть его номер', inviteParam)

  // Хозяин уходит: закрывает приложение.
  await host.context.close()
  await new Promise((r) => setTimeout(r, 1000))

  // Друг открывает ссылку — как из чата.
  const guest = await openApp(browser)
  await passOnboarding(guest.page)
  const matchId = Number(inviteParam.replace('match_', ''))
  const joined = await guest.page.evaluate(async (id) => {
    const token = localStorage.getItem('knb.token')
    const res = await fetch(`/api/matches/${id}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    return { status: res.status, body: await res.text() }
  }, matchId)

  check(joined.status === 200, 'друг вошёл по ссылке', joined)
  check(
    joined.body.includes('"waiting":true'),
    'бой не начался без хозяина — друга просят подождать',
    joined.body.slice(0, 200),
  )

  await guest.context.close()
})

await browser.close()

console.log(`\nИтог: ${passed} прошло, ${failed} не прошло`)
if (failures.length > 0) {
  console.log('\nЧто именно сломано:')
  for (const item of failures) console.log(`  · ${item}`)
}
process.exit(failed === 0 ? 0 : 1)
