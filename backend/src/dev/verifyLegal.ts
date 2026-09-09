/*
 * Проверка юридических документов.
 *
 * Ссылки «Условия использования» и «Политика конфиденциальности» на экране
 * согласия долго вели в пустоту. Человек соглашался с тем, чего не мог
 * прочитать, — а это не согласие, а его видимость.
 *
 * Здесь проверяется, что документы открываются, открываются без входа в игру,
 * на обоих языках, и что в них не осталось незаполненных мест: заглушка вроде
 * «[КОНТАКТНАЯ ПОЧТА]» на живом сайте хуже, чем отсутствие документа, — она
 * показывает, что его никто не читал.
 *
 * Запуск: npm run verify:legal
 */

import { buildServer } from '../server.js'
import { closePool } from '../db/client.js'
import { closeRedis } from '../lib/redis.js'

let passed = 0
let failed = 0

function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    if (detail !== undefined) console.log(`      ${String(detail).slice(0, 200)}`)
    failed++
  }
}

async function main(): Promise<void> {
  const app = await buildServer()

  console.log('\nДокументы открываются')

  for (const [path, name] of [
    ['/legal/terms', 'Условия использования'],
    ['/legal/privacy', 'Политика конфиденциальности'],
  ] as const) {
    // Без токена: читать условия должен мочь и тот, кто ещё не вошёл.
    const page = await app.inject({ method: 'GET', url: path })
    check(page.statusCode === 200, `${name}: страница отдаётся без входа`, page.statusCode)
    check(
      Boolean(page.headers['content-type']?.toString().includes('text/html')),
      `${name}: отдаётся как страница, а не как файл`,
      page.headers['content-type'],
    )
    check(page.body.includes(name), `${name}: заголовок на месте`)
    check(page.body.length > 2000, `${name}: это документ, а не заглушка`, page.body.length)

    const en = await app.inject({ method: 'GET', url: `${path}?lang=en` })
    check(en.statusCode === 200, `${name}: английская редакция отдаётся`)
    check(
      !en.body.includes(name) && en.body.includes('lang="en"'),
      `${name}: по-английски — действительно по-английски`,
    )
  }

  console.log('\nСодержание')

  const terms = await app.inject({ method: 'GET', url: '/legal/terms' })
  const privacy = await app.inject({ method: 'GET', url: '/legal/privacy' })

  /*
   * Главное обещание игры. Если из условий пропадёт «медяки нельзя вывести»,
   * игра из безобидной превратится в ту, за которую Telegram банит боты.
   */
  check(
    terms.body.includes('нельзя вывести') && terms.body.includes('нет денежной стоимости'),
    'в условиях прямо сказано: медяки не выводятся и не стоят денег',
  )
  check(terms.body.includes('18 лет'), 'возрастное ограничение названо')
  check(
    terms.body.includes('программные соперники') || terms.body.includes('программный соперник'),
    'про соперников-программ сказано честно, а не умолчано',
  )

  check(privacy.body.includes('IP'), 'в политике назван IP-адрес, который мы правда храним')
  check(privacy.body.includes('номер телефона'), 'сказано и о том, чего мы НЕ получаем')
  check(privacy.body.includes('удалить аккаунт'), 'право на удаление названо')

  console.log('\nБез выдумок')

  /*
   * Квадратные скобки в готовом документе — это забытая заглушка вроде
   * «[НАЗВАНИЕ ВЛАДЕЛЬЦА]». На живом сайте такое хуже, чем отсутствие
   * документа: видно, что его никто не читал.
   */
  const brackets = /\[[А-ЯA-Z][^\]]{3,}\]/
  check(!brackets.test(terms.body), 'в условиях не осталось незаполненных мест')
  check(!brackets.test(privacy.body), 'в политике не осталось незаполненных мест')

  /*
   * Пока юрлица нет, владелец назван «автор игры», а писать предлагается в
   * чат бота. Это честно и работает. Плохо было бы обратное: выдуманное
   * название компании ради солидности.
   */
  check(
    terms.body.includes('Владелец игры'),
    'сказано, кто стоит за игрой',
  )
  check(
    terms.body.includes('напишите нам') && privacy.body.includes('Напишите'),
    'указано, куда писать',
  )
  check(
    privacy.body.includes('Обязательные нормы') || privacy.body.includes('применяется право') ||
      terms.body.includes('Обязательные нормы') || terms.body.includes('применяется право'),
    'про применимое право сказано без выдуманной страны',
  )

  await app.close()
  await closePool()
  await closeRedis()

  console.log(`\nИтог: ${passed} прошло, ${failed} не прошло`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
