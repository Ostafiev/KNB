/*
 * Проверка ссылки, по которой Telegram открывает окно «Выберите чаты».
 *
 * Это теперь главный и единственный путь отправки приглашения: обычная
 * ссылка вместо команды через Bot API. Команда уходила в пустоту — клиент
 * не показывал окно и не отвечал отказом. Ссылку же Telegram перехватывает
 * сам, и просить его ни о чём не нужно.
 *
 * Здесь важно одно: текст вызова с переводами строк, решётками и амперсандами
 * должен доехать целиком. Без кодирования сообщение обрывается на первом же
 * таком знаке, и друг получает половину вызова.
 *
 * Запуск: node verifyShareHref.mjs
 */

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
    if (detail !== undefined) console.log(`      ${detail}`)
    failed++
  }
}

const BUNDLE = '/tmp/knb-invite.mjs'
execFileSync('node_modules/.bin/esbuild', [
  'src/lib/invite.ts',
  '--bundle',
  '--format=esm',
  `--outfile=${BUNDLE}`,
  '--log-level=warning',
  // Vite подставляет эти значения при сборке; вне неё их нужно задать,
  // иначе модуль падает ещё до первой проверки.
  '--define:import.meta.env={"DEV":false,"VITE_BOT_USERNAME":"KNB343_bot"}',
])

const { buildShareHref } = await import(BUNDLE)

const inviteUrl = 'https://t.me/KNB343_bot?startapp=match_200'
const message =
  'Бросаю тебе вызов в «Камень-ножницы-бумага»!\n' +
  'Условие: кто проиграл — отжимается 10 раз (#спор & расплата)\n' +
  'Ставка: 100 медяков · раундов: 3'

const href = buildShareHref(inviteUrl, message)
const parsed = new URL(href)

console.log('\nСсылка на окно выбора чата')
check(parsed.origin === 'https://t.me', 'ведёт в Telegram, а не куда-то ещё', parsed.origin)
check(parsed.pathname === '/share/url', 'это именно окно «поделиться»', parsed.pathname)
check(
  parsed.searchParams.get('url') === inviteUrl,
  'ссылка на бой доехала целиком, вместе с параметром матча',
  parsed.searchParams.get('url'),
)
check(
  parsed.searchParams.get('text') === message,
  'текст вызова доехал целиком: переводы строк, кавычки, решётка и амперсанд',
  JSON.stringify(parsed.searchParams.get('text')),
)
check(
  !href.includes('\n') && !href.slice('https://t.me/share/url?'.length).includes('#'),
  'в самой ссылке не осталось знаков, обрывающих её',
  href,
)
check(
  href.startsWith('https://t.me/share/url?url=') && href.includes('&text='),
  'порядок и имена параметров те, которые понимает Telegram',
  href,
)

// Бесплатный бой без условия — тоже обычный случай, не должен ломаться.
const plain = new URL(buildShareHref(inviteUrl, 'Бросаю вызов!'))
check(plain.searchParams.get('text') === 'Бросаю вызов!', 'короткий вызов без условия тоже цел')

rmSync(BUNDLE, { force: true })
console.log(`\nИтог: ${passed} прошло, ${failed} не прошло`)
process.exit(failed === 0 ? 0 : 1)
