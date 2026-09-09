import { config } from '../config.js'

/**
 * Условия использования и политика конфиденциальности.
 *
 * Тексты лежат в коде, а не в базе, нарочно: они меняются редко, должны
 * попадать в историю изменений вместе с кодом и не могут «поехать» из-за
 * правки в админке. Дата последнего изменения — здесь же, её видно в самом
 * документе, и человек может убедиться, что читает свежую редакцию.
 *
 * Написано по тому, что приложение делает на самом деле: какие поля пишутся
 * в базу, какие события собираются, что происходит с медяками. Обещать в
 * документе меньше, чем делаешь, так же плохо, как обещать больше.
 *
 * ВАЖНО. Это рабочие тексты, а не заключение юриста. Перед публичным запуском
 * их должен посмотреть человек с профильным образованием: игра со ставками
 * внутриигровой валютой и возрастным ограничением — не та область, где стоит
 * полагаться на здравый смысл.
 */

/**
 * Кто стоит за игрой и куда писать.
 *
 * Юрлица может ещё не быть — и это нормальная стадия. Выдумывать название
 * компании ради солидности нельзя: документ, где написана неправда, хуже
 * документа, которого нет. Поэтому пока владелец — «автор игры», а писать
 * можно в чат бота. Появятся реквизиты и почта — подставятся из настроек
 * сервера, без правки кода и без новой сборки.
 */
function owner(): string {
  return config.legal.owner ?? 'частный разработчик'
}

function ownerEn(): string {
  return config.legal.owner ?? 'a private developer'
}

/** Реквизиты — только если они есть. Пустой хвост «, » выглядит как обрыв. */
function ownerLine(lang: LegalLang): string {
  const name = lang === 'ru' ? owner() : ownerEn()
  return config.legal.ownerDetails ? `${name}, ${config.legal.ownerDetails}` : name
}

/**
 * Применимое право.
 *
 * Пока страна не выбрана, называть её нельзя — а молчать нечестно. Пишем то,
 * что верно в любом случае: обязательные нормы страны игрока действуют
 * независимо от того, что написано в правилах.
 */
function lawParagraph(lang: LegalLang): string {
  const named = config.legal.jurisdiction
  if (lang === 'ru') {
    return named
      ? `К этим правилам применяется право ${named}. Обязательные нормы страны вашего проживания действуют в любом случае.`
      : 'Обязательные нормы страны вашего проживания действуют в любом случае, независимо от того, что написано в этих правилах.'
  }
  return named
    ? `These rules are governed by the law of ${named}. Mandatory rules of your country of residence apply in any case.`
    : 'Mandatory rules of your country of residence apply in any case, whatever these rules say.'
}

/** Куда писать. Без почты остаётся чат бота — он у человека уже открыт. */
function contactLine(lang: LegalLang): string {
  if (config.legal.contact) return config.legal.contact
  const bot = config.botUsername ? `@${config.botUsername}` : null
  if (lang === 'ru') {
    return bot ? `в чат бота ${bot}` : 'в чат бота, через который открыта игра'
  }
  return bot ? `to the bot chat ${bot}` : 'to the bot chat where you opened the game'
}

export const LEGAL_UPDATED_AT = '9 сентября 2026'
export const LEGAL_UPDATED_AT_EN = '9 September 2026'

export type LegalDoc = 'terms' | 'privacy'
export type LegalLang = 'ru' | 'en'

interface Section {
  title: string
  paragraphs: string[]
}

interface Document {
  title: string
  intro: string
  sections: Section[]
}

// ─── Русский ─────────────────────────────────────────────────────────────────

const termsRu: Document = {
  title: 'Условия использования',
  intro:
    `Это правила игры «КНБ» — «Камень, ножницы, бумага» внутри Telegram. ` +
    `Открывая приложение, вы соглашаетесь с тем, что написано ниже. ` +
    `Владелец игры — ${ownerLine('ru')}.`,
  sections: [
    {
      title: '1. Кому можно играть',
      paragraphs: [
        'Игра предназначена для совершеннолетних. Открывая её, вы подтверждаете, что вам исполнилось 18 лет.',
        'Если мы узнаём, что аккаунтом пользуется несовершеннолетний, доступ к игре закрывается, а данные удаляются.',
        'Играть можно только самому и только со своего аккаунта Telegram. Один человек — один аккаунт.',
      ],
    },
    {
      title: '2. Медяки — не деньги',
      paragraphs: [
        'Медяки существуют только внутри игры. Это не валюта, не платёжное средство и не имущество. У них нет денежной стоимости.',
        'Медяки нельзя вывести, обменять на деньги или передать другому человеку. Никакой возможности получить за них деньги — ни в игре, ни где-либо ещё — не существует и не предполагается.',
        'Медяки начисляются бесплатно: за первый вход, за ежедневное посещение, за приглашённых друзей. Их количество может меняться по решению владельца.',
        'Проигранные медяки не восстанавливаются. Начисленные медяки не являются вашей собственностью и могут быть аннулированы при закрытии игры или блокировке аккаунта.',
      ],
    },
    {
      title: '3. Соперники',
      paragraphs: [
        'В игре встречаются и живые игроки, и программные соперники. Программный соперник выбирает фигуру случайно и делает это до того, как вы сделали свой ход, — подсмотреть чужой выбор он не может физически.',
        'Из-за случайного выбора программного соперника обыграть его чаще, чем в трети раундов, невозможно ни человеку, ни программе. Это не приём против игрока, а следствие правил самой игры.',
        'Результат каждого раунда и матча определяет сервер. В спорной ситуации данные сервера считаются верными.',
      ],
    },
    {
      title: '4. Что делать нельзя',
      paragraphs: [
        'Заводить несколько аккаунтов, в том числе ради бонусов за приглашённых друзей.',
        'Играть автоматически: скриптами, ботами, эмуляторами нажатий.',
        'Пытаться вмешаться в работу сервера, подделывать запросы, использовать ошибки приложения для получения медяков.',
        'Договариваться с другим игроком о результате матча ради перевода медяков между аккаунтами.',
        'За нарушение этих правил аккаунт блокируется без предупреждения. Медяки при этом аннулируются.',
      ],
    },
    {
      title: '5. Условие пари между игроками',
      paragraphs: [
        'Приглашая друга, вы можете вписать условие — например, «проигравший отжимается десять раз». Это ваша договорённость между собой.',
        'Владелец игры не участвует в таких договорённостях, не следит за их исполнением и не отвечает за последствия. Игра лишь передаёт текст условия вашему другу вместе с приглашением.',
        'Не вписывайте в условие ничего противозаконного, оскорбительного или опасного для здоровья.',
      ],
    },
    {
      title: '6. Доступность игры',
      paragraphs: [
        'Игра предоставляется как есть. Мы не обещаем, что она будет работать без перерывов и ошибок.',
        'Игра может быть изменена, приостановлена или закрыта в любой момент. Медяки при этом не компенсируются, поскольку не имеют денежной стоимости.',
        'Ответственность владельца ограничена в той мере, в какой это допускает применимое право.',
      ],
    },
    {
      title: '7. Изменения правил',
      paragraphs: [
        'Правила могут меняться. Дата последней редакции указана в конце документа.',
        'Если изменения существенные, мы покажем их в приложении и попросим согласия заново. Продолжая играть после изменений, вы принимаете новую редакцию.',
      ],
    },
    {
      title: '8. Право и споры',
      paragraphs: [
        lawParagraph('ru'),
        `Прежде чем идти дальше, напишите нам ${contactLine('ru')}. Большинство вопросов решается перепиской.`,
      ],
    },
  ],
}

const privacyRu: Document = {
  title: 'Политика конфиденциальности',
  intro:
    `Здесь честно перечислено, какие данные игра «КНБ» собирает, зачем и что с ними происходит. ` +
    `Данные обрабатывает ${ownerLine('ru')}.`,
  sections: [
    {
      title: '1. Что мы получаем от Telegram',
      paragraphs: [
        'Когда вы открываете игру, Telegram передаёт нам: ваш числовой идентификатор, имя и фамилию из профиля, юзернейм, ссылку на фотографию профиля и язык интерфейса.',
        'Мы не получаем ваш номер телефона, список контактов, переписку и не имеем к ним доступа. Telegram их не передаёт.',
        'Подпись этих данных проверяется на сервере — так мы убеждаемся, что перед нами действительно вы, а не подделанный запрос.',
      ],
    },
    {
      title: '2. Что появляется в процессе игры',
      paragraphs: [
        'Ник и аватар, которые вы выбрали. Ник может отличаться от имени в Telegram — это ваше решение.',
        'Баланс медяков, рейтинг, история матчей: кто с кем играл, какие фигуры выбирали, чем закончилось.',
        'Журнал операций с медяками: начисления, ставки, выигрыши. Он нужен, чтобы баланс всегда сходился и можно было разобрать спорный случай.',
        'Связи приглашений: кто кого позвал в игру.',
        'IP-адрес в момент первой регистрации. Он нужен ровно для одного: замечать попытки завести десяток аккаунтов ради бонусов.',
        'Служебные события: вход в игру, создание боя, выход из матча, срабатывание таймера. По ним видно, где приложение ведёт себя не так, как задумано.',
        'Отметка о том, что вы приняли эти документы, и время, когда это произошло.',
      ],
    },
    {
      title: '3. Зачем это нужно',
      paragraphs: [
        'Чтобы игра работала: узнавать вас при входе, вести счёт, начислять и списывать медяки, показывать историю.',
        'Чтобы игра была честной: замечать мультиаккаунты, автоматизацию и попытки обойти правила.',
        'Чтобы чинить поломки: без служебных событий разбор жалобы превращается в гадание.',
        'Мы не продаём ваши данные, не передаём их рекламодателям и не используем для рекламы.',
      ],
    },
    {
      title: '4. Кто ещё их видит',
      paragraphs: [
        'Хостинг и база данных — компании, на серверах которых работает игра. Они хранят данные по нашему поручению и не вправе распоряжаться ими сами.',
        'Telegram — как канал, через который вы к нам приходите. На то, что происходит внутри Telegram, действует его собственная политика.',
        'Государственные органы — только если этого требует закон.',
        'Другие игроки видят лишь то, что видно в игре: ваш ник, аватар, рейтинг и историю матчей с вами.',
      ],
    },
    {
      title: '5. Сколько храним',
      paragraphs: [
        'Пока вы пользуетесь игрой — и ещё некоторое время после, чтобы можно было восстановить аккаунт и разобрать споры.',
        'Служебные события хранятся не дольше года.',
        'Журнал операций с медяками хранится дольше остального: он нужен, чтобы сходился общий баланс игры.',
      ],
    },
    {
      title: '6. Ваши права',
      paragraphs: [
        `Вы можете попросить показать, какие данные о вас есть, исправить их или удалить аккаунт. Напишите ${contactLine('ru')}.`,
        'После удаления аккаунта ник и история матчей обезличиваются: другие игроки увидят «удалённый игрок» вместо вашего имени.',
        'Некоторые записи — например, журнал операций — остаются в обезличенном виде, потому что без них не сойдётся общий баланс.',
      ],
    },
    {
      title: '7. Дети',
      paragraphs: [
        'Игра не предназначена для лиц младше 18 лет, и мы сознательно не собираем их данные.',
        `Если вы родитель и считаете, что ваш ребёнок пользуется игрой, напишите ${contactLine('ru')} — мы закроем доступ и удалим данные.`,
      ],
    },
    {
      title: '8. Изменения',
      paragraphs: [
        'Эта политика может меняться. Дата последней редакции указана в конце документа.',
        'О существенных изменениях мы сообщим в приложении.',
      ],
    },
  ],
}

// ─── English ─────────────────────────────────────────────────────────────────

const termsEn: Document = {
  title: 'Terms of Use',
  intro:
    `These are the rules of KNB — Rock Paper Scissors inside Telegram. ` +
    `By opening the app you accept what is written below. ` +
    `The game is owned by ${ownerLine('en')}.`,
  sections: [
    {
      title: '1. Who may play',
      paragraphs: [
        'The game is for adults. By opening it you confirm that you are 18 or older.',
        'If we learn that an account belongs to a minor, we close access and delete the data.',
        'Play only as yourself and only from your own Telegram account. One person, one account.',
      ],
    },
    {
      title: '2. Coins are not money',
      paragraphs: [
        'Coins exist only inside the game. They are not currency, not a means of payment and not property. They have no monetary value.',
        'Coins cannot be withdrawn, exchanged for money or transferred to another person. There is no way to turn them into money — inside the game or anywhere else — and none is planned.',
        'Coins are granted for free: for signing up, for daily visits, for inviting friends. The amounts may change at the owner’s discretion.',
        'Lost coins are not restored. Granted coins are not your property and may be voided if the game closes or your account is blocked.',
      ],
    },
    {
      title: '3. Opponents',
      paragraphs: [
        'You will meet both live players and software opponents. A software opponent picks its shape at random and does so before you make your move — it physically cannot see your choice.',
        'Because that choice is random, neither a person nor a program can beat a software opponent more than a third of the time. That is a consequence of the game itself, not a trick against you.',
        'The outcome of every round and match is decided by the server. In a dispute, server data is authoritative.',
      ],
    },
    {
      title: '4. What is not allowed',
      paragraphs: [
        'Creating multiple accounts, including for invitation bonuses.',
        'Playing automatically: scripts, bots, tap emulators.',
        'Interfering with the server, forging requests, or exploiting bugs to obtain coins.',
        'Arranging match results with another player in order to move coins between accounts.',
        'Breaking these rules leads to a block without warning. Coins are voided.',
      ],
    },
    {
      title: '5. Wagers between players',
      paragraphs: [
        'When inviting a friend you may write a wager — for example, "the loser does ten push-ups". That is an arrangement between the two of you.',
        'The owner takes no part in such arrangements, does not enforce them and is not responsible for the consequences. The game only passes your text along with the invitation.',
        'Do not write anything unlawful, offensive or dangerous to health.',
      ],
    },
    {
      title: '6. Availability',
      paragraphs: [
        'The game is provided as is. We do not promise uninterrupted or error-free operation.',
        'The game may be changed, suspended or closed at any time. Coins are not compensated, as they have no monetary value.',
        'The owner’s liability is limited to the extent permitted by applicable law.',
      ],
    },
    {
      title: '7. Changes',
      paragraphs: [
        'These rules may change. The date of the latest revision is at the end of this document.',
        'For material changes we will show them in the app and ask for your consent again. Continuing to play means accepting the new version.',
      ],
    },
    {
      title: '8. Law and disputes',
      paragraphs: [
        lawParagraph('en'),
        `Before going further, write ${contactLine('en')}. Most questions are settled by correspondence.`,
      ],
    },
  ],
}

const privacyEn: Document = {
  title: 'Privacy Policy',
  intro:
    `This is a plain list of what data KNB collects, why, and what happens to it. ` +
    `Data is processed by ${ownerLine('en')}.`,
  sections: [
    {
      title: '1. What Telegram gives us',
      paragraphs: [
        'When you open the game, Telegram passes us your numeric id, first and last name from your profile, username, a link to your profile photo, and interface language.',
        'We do not receive your phone number, contacts or messages, and we have no access to them. Telegram does not pass them on.',
        'The signature of this data is verified on the server, so we know it is really you and not a forged request.',
      ],
    },
    {
      title: '2. What appears as you play',
      paragraphs: [
        'The nickname and avatar you chose. Your nickname may differ from your Telegram name — that is your call.',
        'Coin balance, rating, match history: who played whom, which shapes were chosen, how it ended.',
        'A ledger of coin operations: grants, stakes, winnings. It exists so the balance always adds up and disputes can be examined.',
        'Invitation links: who brought whom into the game.',
        'Your IP address at first sign-up. It serves exactly one purpose: noticing attempts to create a dozen accounts for bonuses.',
        'Service events: opening the game, creating a match, leaving a match, timers firing. They show where the app behaves differently from the design.',
        'A record that you accepted these documents, and when.',
      ],
    },
    {
      title: '3. Why we need it',
      paragraphs: [
        'To make the game work: recognise you at sign-in, keep score, grant and deduct coins, show history.',
        'To keep it fair: notice multi-accounts, automation and attempts to work around the rules.',
        'To fix breakage: without service events, investigating a complaint turns into guesswork.',
        'We do not sell your data, do not pass it to advertisers and do not use it for advertising.',
      ],
    },
    {
      title: '4. Who else sees it',
      paragraphs: [
        'Hosting and database providers, on whose servers the game runs. They store data on our instructions and may not use it themselves.',
        'Telegram, as the channel you arrive through. What happens inside Telegram is governed by its own policy.',
        'Public authorities, only where the law requires it.',
        'Other players see only what the game shows: your nickname, avatar, rating and the history of matches with you.',
      ],
    },
    {
      title: '5. How long we keep it',
      paragraphs: [
        'While you use the game, and for some time afterwards, so an account can be restored and disputes examined.',
        'Service events are kept no longer than a year.',
        'The coin ledger is kept longer than the rest: without it the overall balance of the game does not add up.',
      ],
    },
    {
      title: '6. Your rights',
      paragraphs: [
        `You may ask what data we hold about you, correct it, or delete your account. Write ${contactLine('en')}.`,
        'After deletion your nickname and match history are anonymised: other players see "deleted player" instead of your name.',
        'Some records — the coin ledger, for instance — remain in anonymised form, because without them the overall balance does not add up.',
      ],
    },
    {
      title: '7. Children',
      paragraphs: [
        'The game is not intended for anyone under 18, and we do not knowingly collect their data.',
        `If you are a parent and believe your child uses the game, write ${contactLine('en')} — we will close access and delete the data.`,
      ],
    },
    {
      title: '8. Changes',
      paragraphs: [
        'This policy may change. The date of the latest revision is at the end of this document.',
        'We will announce material changes in the app.',
      ],
    },
  ],
}

const DOCUMENTS: Record<LegalLang, Record<LegalDoc, Document>> = {
  ru: { terms: termsRu, privacy: privacyRu },
  en: { terms: termsEn, privacy: privacyEn },
}

/**
 * Готовая страница.
 *
 * Ни внешних шрифтов, ни скриптов: документ должен открываться и читаться
 * даже там, где всё остальное заблокировано. Цвета — под тёмную и светлую
 * тему устройства, потому что открывается он внутри Telegram.
 */
export function renderLegal(doc: LegalDoc, lang: LegalLang): string {
  const document = DOCUMENTS[lang][doc]
  const updated = lang === 'ru' ? LEGAL_UPDATED_AT : LEGAL_UPDATED_AT_EN
  const updatedLabel = lang === 'ru' ? 'Редакция от' : 'Last updated'
  const other = doc === 'terms' ? 'privacy' : 'terms'
  const otherLabel =
    lang === 'ru'
      ? doc === 'terms'
        ? 'Политика конфиденциальности'
        : 'Условия использования'
      : doc === 'terms'
        ? 'Privacy Policy'
        : 'Terms of Use'

  const body = document.sections
    .map(
      (section) =>
        `<h2>${escape(section.title)}</h2>` +
        section.paragraphs.map((p) => `<p>${escape(p)}</p>`).join(''),
    )
    .join('')

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(document.title)} — КНБ</title>
<style>
  :root { color-scheme: light dark; --fg: #16202b; --muted: #5b6b82; --bg: #eef2f7; --line: rgba(20,40,66,.12); --link: #1c82bd; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e8edf2; --muted: #8a9ab5; --bg: #17212b; --line: rgba(255,255,255,.12); --link: #64d2ff; }
  }
  body {
    margin: 0; padding: 24px 20px 64px;
    background: var(--bg); color: var(--fg);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 720px; margin-inline: auto;
    -webkit-text-size-adjust: 100%;
  }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 12px; }
  h2 { font-size: 17px; line-height: 1.3; margin: 28px 0 8px; }
  p { margin: 0 0 10px; }
  .intro { color: var(--muted); }
  .meta { color: var(--muted); font-size: 14px; margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); }
  a { color: var(--link); }
</style>
</head>
<body>
<h1>${escape(document.title)}</h1>
<p class="intro">${escape(document.intro)}</p>
${body}
<p class="meta">${escape(updatedLabel)} ${escape(updated)}<br><a href="/legal/${other}?lang=${lang}">${escape(otherLabel)}</a></p>
</body>
</html>`
}

/** Текст документа — данные, а не разметка. Экранируем перед вставкой. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
