import type { FastifyInstance } from 'fastify'
import formbody from '@fastify/formbody'
import { z } from 'zod'
import { config } from '../config.js'
import { query, withTransaction } from '../db/client.js'
import { getEconomyConfig, invalidateEconomyCache } from '../domain/appConfig.js'
import { postEntry } from '../domain/ledger.js'
import {
  audit,
  clearSessionCookie,
  findAdminByTelegramId,
  LoginError,
  requireAdmin,
  setSessionCookie,
  verifyLoginWidget,
} from './auth.js'
import { card, coins, esc, layout, num, pager, table, when } from './html.js'
import * as q from './queries.js'

/**
 * Страницы админ-панели.
 *
 * Каждое действие, которое что-то меняет, оставляет запись в журнале: кто,
 * когда, что было и что стало. Это не бюрократия — без такого журнала
 * ошибочную правку баланса невозможно ни найти, ни откатить.
 */

const CHOICE_EMOJI: Record<string, string> = {
  rock: '✊',
  scissors: '✌️',
  paper: '✋',
}

const TX_LABEL: Record<string, string> = {
  signup_bonus: 'бонус за регистрацию',
  daily_bonus: 'ежедневный бонус',
  referral_bonus: 'бонус за приглашённого',
  referral_signup: 'бонус по приглашению',
  ad_reward: 'реклама',
  bet_hold: 'ставка',
  bet_refund: 'возврат ставки',
  match_win: 'выигрыш',
  topup_stars: 'пополнение звёздами',
  topup_ton: 'пополнение TON',
  withdrawal: 'вывод',
  withdrawal_fee: 'комиссия вывода',
  admin_adjustment: 'правка администратора',
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(formbody)

  // ─── Вход ──────────────────────────────────────────────────────────────────

  app.get('/admin/login', async (request, reply) => {
    const error = (request.query as { error?: string }).error
    const seen = (request.query as { id?: string }).id

    const widget = config.botUsername
      ? `<script async src="https://telegram.org/js/telegram-widget.js?22"
           data-telegram-login="${esc(config.botUsername)}"
           data-size="large"
           data-userpic="false"
           data-auth-url="/admin/login/telegram"
           data-request-access="write"></script>`
      : `<div class="note warn">Не задан юзернейм бота: добавьте переменную
           <code>BOT_USERNAME</code> в настройках сервера.</div>`

    const hint = seen
      ? `<div class="note warn">Этот аккаунт не в списке администраторов.<br>
           Ваш Telegram id: <b>${esc(seen)}</b> — добавьте его в переменную
           <code>ADMIN_TELEGRAM_IDS</code> и перезапустите сервер.</div>`
      : error
        ? `<div class="note warn">Войти не получилось: ${esc(error)}</div>`
        : ''

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Вход',
        active: '',
        body: `
          <h1>Админ-панель</h1>
          <p class="sub">Вход по Telegram-аккаунту. Пароля нет: панель двигает
             балансы игроков, и подбирать здесь нечего.</p>
          ${hint}
          <div class="card" style="max-width:360px">${widget}</div>
          <div class="note">Кнопка не появилась? В BotFather нужно один раз
             выполнить <code>/setdomain</code> и указать адрес этого сервера.</div>
        `,
      }),
    )
  })

  app.get('/admin/login/telegram', async (request, reply) => {
    if (!config.TELEGRAM_BOT_TOKEN) {
      return reply.redirect('/admin/login?error=на+сервере+не+задан+токен+бота')
    }

    try {
      const data = verifyLoginWidget(
        request.query as Record<string, string>,
        config.TELEGRAM_BOT_TOKEN,
      )

      const admin = await findAdminByTelegramId(data.id)
      if (!admin || admin.disabled_at) {
        return reply.redirect(`/admin/login?id=${data.id}`)
      }

      await query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id])
      setSessionCookie(reply, admin.id)
      await audit(admin.id, 'login', { type: 'admin', id: admin.id }, { ip: request.ip })

      return reply.redirect('/admin')
    } catch (error) {
      const message = error instanceof LoginError ? error.message : 'неизвестная ошибка'
      request.log.warn({ err: error }, 'вход в админку не прошёл')
      return reply.redirect(`/admin/login?error=${encodeURIComponent(message)}`)
    }
  })

  app.get('/admin/logout', async (_request, reply) => {
    clearSessionCookie(reply)
    return reply.redirect('/admin/login')
  })

  // ─── Сводка ────────────────────────────────────────────────────────────────

  app.get('/admin', { preHandler: requireAdmin }, async (request, reply) => {
    const [stats, days] = await Promise.all([q.overview(), q.lastDays(14)])

    const maxActive = Math.max(1, ...days.map((d) => d.active))
    const rows = days.map(
      (d) => `<tr>
        <td>${esc(d.day.split('-').reverse().slice(0, 2).join('.'))}</td>
        <td style="width:40%"><div class="bar"><i style="width:${Math.round((d.active / maxActive) * 100)}%"></i></div></td>
        <td class="num">${num(d.active)}</td>
        <td class="num">${num(d.matches)}</td>
        <td class="num">${num(d.wagered)}</td>
      </tr>`,
    )

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Сводка',
        active: '/admin',
        admin: request.currentAdmin!,
        body: `
          <h1>Сводка</h1>
          <p class="sub">Всё считается из тех же таблиц, которыми живёт игра.</p>

          <div class="cards">
            ${card('Игроков всего', num(stats.players), `+${stats.playersToday} сегодня`)}
            ${card('Заходили сегодня', num(stats.activeToday), `${num(stats.activeWeek)} за неделю`)}
            ${card('Матчей сыграно', num(stats.matchesTotal), `${stats.matchesToday} сегодня`)}
            ${card('Ставок сегодня', num(stats.wageredToday) + ' 🪙', 'сумма обеих сторон')}
            ${card('Медяков у игроков', num(stats.coinsInPlay) + ' 🪙', `выдано всего ${num(stats.issued)}`)}
            ${card('Идёт сейчас', num(stats.matchesLive), `${stats.searching} ждут соперника`)}
          </div>

          <h2>Последние две недели</h2>
          ${table(['День', 'Заходы', '#Игроков', '#Матчей', '#Ставки'], rows)}
        `,
      }),
    )
  })

  // ─── Игроки ────────────────────────────────────────────────────────────────

  app.get('/admin/players', { preHandler: requireAdmin }, async (request, reply) => {
    const { search, page } = z
      .object({ search: z.string().default(''), page: z.coerce.number().int().min(0).default(0) })
      .parse(request.query ?? {})

    const { rows, hasMore } = await q.players(search, page)

    const body = rows.map(
      (p) => `<tr>
        <td><a href="/admin/players/${p.id}">${esc(p.nickname)}</a>
            ${p.banned_at ? '<span class="tag bad">заблокирован</span>' : ''}</td>
        <td class="dim">${p.telegram_username ? '@' + esc(p.telegram_username) : esc(p.telegram_id)}</td>
        <td class="num">${num(p.rating)}</td>
        <td class="num">${num(p.coins_balance)}</td>
        <td class="num">${num(p.games_played)}</td>
        <td class="dim">${when(p.last_seen_at)}</td>
      </tr>`,
    )

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Игроки',
        active: '/admin/players',
        admin: request.currentAdmin!,
        body: `
          <h1>Игроки</h1>
          <form class="inline" method="get" action="/admin/players" style="margin-bottom:16px">
            <input name="search" value="${esc(search)}" placeholder="имя, @юзернейм или номер" style="min-width:260px">
            <button>Найти</button>
            ${search ? '<a href="/admin/players">сбросить</a>' : ''}
          </form>
          ${table(['Игрок', 'Telegram', '#Рейтинг', '#Медяки', '#Игр', 'Заходил'], body)}
          ${pager('/admin/players', page, hasMore, search ? `&search=${encodeURIComponent(search)}` : '')}
        `,
      }),
    )
  })

  app.get<{ Params: { id: string } }>(
    '/admin/players/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id)
      const player = Number.isSafeInteger(id) ? await q.player(id) : null
      if (!player) return reply.code(404).type('text/html; charset=utf-8').send('Игрок не найден')

      const [ledger, tx, played] = await Promise.all([
        q.playerLedger(id),
        q.transactions({ userId: id }, 0, 20),
        q.matches({ userId: id }, 0, 10),
      ])

      const txRows = tx.rows.map(
        (t) => `<tr>
          <td>${esc(TX_LABEL[t.type] ?? t.type)}</td>
          <td class="num">${coins(t.amount)}</td>
          <td class="num dim">${num(t.balance_after)}</td>
          <td class="dim">${when(t.created_at)}</td>
        </tr>`,
      )

      const matchRows = played.rows.map((m) => {
        const iAmFirst = m.player1_id === id
        const opponent = iAmFirst ? m.player2 : m.player1
        const my = iAmFirst ? m.score1 : m.score2
        const their = iAmFirst ? m.score2 : m.score1
        const won = m.winner_id === id
        return `<tr>
          <td><a href="/admin/matches/${m.id}">#${m.id}</a></td>
          <td>${esc(opponent ?? '—')}</td>
          <td class="num">${my}:${their}</td>
          <td>${m.status === 'finished' ? (won ? '<span class="tag ok">победа</span>' : '<span class="tag bad">поражение</span>') : `<span class="tag">${esc(m.status)}</span>`}</td>
          <td class="num">${num(m.bet_amount)}</td>
          <td class="dim">${when(m.finished_at ?? m.created_at)}</td>
        </tr>`
      })

      const mismatch =
        ledger.balance !== ledger.sum
          ? `<div class="note warn">Баланс не сходится с журналом: на счету
               ${num(ledger.balance)}, по операциям ${num(ledger.sum)}.
               Это признак ошибки — покажите мне эту страницу.</div>`
          : `<div class="note">Баланс сходится с журналом операций: ${num(ledger.balance)} 🪙.</div>`

      return reply.type('text/html; charset=utf-8').send(
        layout({
          title: player.nickname,
          active: '/admin/players',
          admin: request.currentAdmin!,
          body: `
            <h1>${esc(player.nickname)} ${player.banned_at ? '<span class="tag bad">заблокирован</span>' : ''}</h1>
            <p class="sub">
              ${player.telegram_username ? '@' + esc(player.telegram_username) + ' · ' : ''}
              Telegram ${esc(player.telegram_id)} · в игре с ${when(player.created_at)}
            </p>

            <div class="cards">
              ${card('Медяки', num(player.coins_balance))}
              ${card('Рейтинг', num(player.rating))}
              ${card('Матчей', num(player.games_played), `${player.wins} побед · ${player.losses} поражений`)}
              ${card('Последний заход', when(player.last_seen_at))}
            </div>

            ${mismatch}

            <div class="row">
              <div>
                <h2>Изменить баланс</h2>
                <form class="inline" method="post" action="/admin/players/${id}/balance">
                  <input name="amount" type="number" placeholder="+100 или -50" required style="width:140px">
                  <input name="comment" placeholder="за что" required style="min-width:200px">
                  <button>Провести</button>
                </form>
                <p class="sub" style="margin-top:8px">Пройдёт через журнал операций,
                   как обычное начисление. В минус увести нельзя.</p>
              </div>

              <div>
                <h2>Доступ</h2>
                <form class="inline" method="post" action="/admin/players/${id}/ban">
                  ${
                    player.banned_at
                      ? '<button class="ghost" name="action" value="unban">Разблокировать</button>'
                      : `<input name="reason" placeholder="причина" required style="min-width:200px">
                         <button class="danger" name="action" value="ban">Заблокировать</button>`
                  }
                </form>
                <p class="sub" style="margin-top:8px">Заблокированный не сможет войти
                   и играть. Медяки и история остаются.</p>
              </div>
            </div>

            <h2>Последние матчи</h2>
            ${table(['Матч', 'Соперник', '#Счёт', 'Итог', '#Ставка', 'Когда'], matchRows)}
            <div class="pager"><a href="/admin/matches?user=${id}">все матчи игрока →</a></div>

            <h2>Последние операции</h2>
            ${table(['Операция', '#Сумма', '#Стало', 'Когда'], txRows)}
            <div class="pager"><a href="/admin/transactions?user=${id}">все операции игрока →</a></div>
          `,
        }),
      )
    },
  )

  app.post<{ Params: { id: string } }>(
    '/admin/players/:id/balance',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id)
      const parsed = z
        .object({
          amount: z.coerce.number().int().refine((v) => v !== 0, 'нужна ненулевая сумма'),
          comment: z.string().trim().min(1).max(200),
        })
        .safeParse(request.body)

      if (!Number.isSafeInteger(id) || !parsed.success) {
        return reply.redirect(`/admin/players/${id}`)
      }

      const before = await q.player(id)
      if (!before) return reply.redirect('/admin/players')

      try {
        await withTransaction(async (client) => {
          await postEntry(client, {
            userId: id,
            type: 'admin_adjustment',
            amount: parsed.data.amount,
            adminId: request.currentAdmin!.id,
            comment: parsed.data.comment,
          })
        })

        const after = await q.player(id)
        await audit(
          request.currentAdmin!.id,
          'balance_adjust',
          { type: 'user', id },
          {
            before: { balance: before.coins_balance },
            after: { balance: after?.coins_balance },
            comment: `${parsed.data.amount > 0 ? '+' : ''}${parsed.data.amount}: ${parsed.data.comment}`,
            ip: request.ip,
          },
        )
      } catch (error) {
        request.log.error({ err: error }, 'правка баланса не прошла')
      }

      return reply.redirect(`/admin/players/${id}`)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/admin/players/:id/ban',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id)
      const parsed = z
        .object({ action: z.enum(['ban', 'unban']), reason: z.string().trim().max(200).optional() })
        .safeParse(request.body)

      if (!Number.isSafeInteger(id) || !parsed.success) {
        return reply.redirect(`/admin/players/${id}`)
      }

      const before = await q.player(id)
      if (!before) return reply.redirect('/admin/players')

      if (parsed.data.action === 'ban') {
        await query('UPDATE users SET banned_at = now(), ban_reason = $2 WHERE id = $1', [
          id,
          parsed.data.reason ?? null,
        ])
      } else {
        await query('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = $1', [id])
      }

      await audit(
        request.currentAdmin!.id,
        parsed.data.action === 'ban' ? 'player_ban' : 'player_unban',
        { type: 'user', id },
        {
          before: { banned: before.banned_at !== null },
          after: { banned: parsed.data.action === 'ban' },
          comment: parsed.data.reason,
          ip: request.ip,
        },
      )

      return reply.redirect(`/admin/players/${id}`)
    },
  )

  // ─── Матчи ─────────────────────────────────────────────────────────────────

  app.get('/admin/matches', { preHandler: requireAdmin }, async (request, reply) => {
    const { page, user, status } = z
      .object({
        page: z.coerce.number().int().min(0).default(0),
        user: z.coerce.number().int().positive().optional(),
        status: z.string().optional(),
      })
      .parse(request.query ?? {})

    const { rows, hasMore } = await q.matches({ userId: user, status }, page)

    const body = rows.map(
      (m) => `<tr>
        <td><a href="/admin/matches/${m.id}">#${m.id}</a></td>
        <td>${esc(m.player1)} <span class="dim">против</span> ${esc(m.player2 ?? '—')}</td>
        <td class="num">${m.score1}:${m.score2}</td>
        <td class="num">${num(m.bet_amount)}</td>
        <td>${esc(m.rounds_total)}</td>
        <td><span class="tag ${m.status === 'finished' ? 'ok' : ''}">${esc(m.status)}</span>
            ${m.finish_reason === 'abandoned' ? '<span class="tag bad">бросили</span>' : ''}</td>
        <td class="dim">${when(m.finished_at ?? m.created_at)}</td>
      </tr>`,
    )

    const extra = [user ? `&user=${user}` : '', status ? `&status=${status}` : ''].join('')

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Матчи',
        active: '/admin/matches',
        admin: request.currentAdmin!,
        body: `
          <h1>Матчи</h1>
          <form class="inline" method="get" action="/admin/matches" style="margin-bottom:16px">
            <select name="status">
              <option value="">любое состояние</option>
              ${['finished', 'active', 'searching', 'pending', 'cancelled']
                .map(
                  (s) =>
                    `<option value="${s}" ${status === s ? 'selected' : ''}>${esc(s)}</option>`,
                )
                .join('')}
            </select>
            ${user ? `<input type="hidden" name="user" value="${user}">` : ''}
            <button>Показать</button>
            ${user || status ? '<a href="/admin/matches">сбросить</a>' : ''}
          </form>
          ${table(['Матч', 'Игроки', '#Счёт', '#Ставка', 'Раундов', 'Состояние', 'Когда'], body)}
          ${pager('/admin/matches', page, hasMore, extra)}
        `,
      }),
    )
  })

  app.get<{ Params: { id: string } }>(
    '/admin/matches/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id)
      const match = Number.isSafeInteger(id) ? await q.matchById(id) : null
      if (!match) return reply.code(404).type('text/html; charset=utf-8').send('Матч не найден')

      const rounds = await q.matchRounds(id)

      const roundRows = rounds.map((r) => {
        const think = (moveAt: string | null): string =>
          moveAt
            ? `${((new Date(moveAt).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1)} с`
            : '<span class="dim">не сходил</span>'

        const outcome =
          r.result === 'draw'
            ? 'ничья'
            : r.result === 'player1'
              ? esc(match.player1)
              : r.result === 'player2'
                ? esc(match.player2 ?? '—')
                : '<span class="dim">не доигран</span>'

        return `<tr>
          <td>${r.round_number}</td>
          <td>${r.player1_choice ? CHOICE_EMOJI[r.player1_choice] : '—'} ${think(r.player1_move_at)}</td>
          <td>${r.player2_choice ? CHOICE_EMOJI[r.player2_choice] : '—'} ${think(r.player2_move_at)}</td>
          <td>${outcome}</td>
          <td>${r.abandoned ? '<span class="tag bad">вышел</span>' : ''}
              ${r.player1_timed_out || r.player2_timed_out ? '<span class="tag">таймаут</span>' : ''}</td>
        </tr>`
      })

      const winner =
        match.winner_id === match.player1_id
          ? match.player1
          : match.winner_id === match.player2_id
            ? match.player2
            : null

      return reply.type('text/html; charset=utf-8').send(
        layout({
          title: `Матч #${match.id}`,
          active: '/admin/matches',
          admin: request.currentAdmin!,
          body: `
            <h1>Матч #${match.id}</h1>
            <p class="sub">
              <a href="/admin/players/${match.player1_id}">${esc(match.player1)}</a>
              против
              ${match.player2_id ? `<a href="/admin/players/${match.player2_id}">${esc(match.player2)}</a>` : '—'}
              · ${esc(match.mode)} · ${when(match.created_at)}
            </p>

            <div class="cards">
              ${card('Счёт', `${match.score1}:${match.score2}`, `до ${Math.ceil(match.rounds_total / 2)} побед`)}
              ${card('Ставка', num(match.bet_amount) + ' 🪙', 'с каждого')}
              ${card('Победитель', winner ? esc(winner) : '—', match.finish_reason === 'abandoned' ? 'соперник вышел' : '')}
              ${card('Состояние', esc(match.status), match.finished_at ? when(match.finished_at) : '')}
            </div>

            <h2>Раунды</h2>
            <p class="sub">Время хода считает сервер от начала раунда: по нему видно,
               думал игрок или ответил быстрее человеческой реакции.</p>
            ${table(['#', esc(match.player1), esc(match.player2 ?? '—'), 'Выиграл', ''], roundRows)}
          `,
        }),
      )
    },
  )

  // ─── Операции ──────────────────────────────────────────────────────────────

  app.get('/admin/transactions', { preHandler: requireAdmin }, async (request, reply) => {
    const { page, user, type } = z
      .object({
        page: z.coerce.number().int().min(0).default(0),
        user: z.coerce.number().int().positive().optional(),
        type: z.string().optional(),
      })
      .parse(request.query ?? {})

    const { rows, hasMore } = await q.transactions({ userId: user, type }, page)

    const body = rows.map(
      (t) => `<tr>
        <td><a href="/admin/players/${t.user_id}">${esc(t.nickname)}</a></td>
        <td>${esc(TX_LABEL[t.type] ?? t.type)}</td>
        <td class="num">${coins(t.amount)}</td>
        <td class="num dim">${num(t.balance_after)}</td>
        <td>${t.match_id ? `<a href="/admin/matches/${t.match_id}">#${t.match_id}</a>` : ''}</td>
        <td class="dim">${esc(t.comment ?? '')}</td>
        <td class="dim">${when(t.created_at)}</td>
      </tr>`,
    )

    const extra = [user ? `&user=${user}` : '', type ? `&type=${type}` : ''].join('')

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Операции',
        active: '/admin/transactions',
        admin: request.currentAdmin!,
        body: `
          <h1>Операции</h1>
          <p class="sub">Полный журнал движений медяков. Баланс любого игрока —
             это сумма его строк отсюда, и ничего больше.</p>
          <form class="inline" method="get" action="/admin/transactions" style="margin-bottom:16px">
            <select name="type">
              <option value="">любая операция</option>
              ${Object.entries(TX_LABEL)
                .map(
                  ([key, label]) =>
                    `<option value="${key}" ${type === key ? 'selected' : ''}>${esc(label)}</option>`,
                )
                .join('')}
            </select>
            ${user ? `<input type="hidden" name="user" value="${user}">` : ''}
            <button>Показать</button>
            ${user || type ? '<a href="/admin/transactions">сбросить</a>' : ''}
          </form>
          ${table(['Игрок', 'Операция', '#Сумма', '#Стало', 'Матч', 'Комментарий', 'Когда'], body)}
          ${pager('/admin/transactions', page, hasMore, extra)}
        `,
      }),
    )
  })

  // ─── Поведение ─────────────────────────────────────────────────────────────

  app.get('/admin/funnel', { preHandler: requireAdmin }, async (request, reply) => {
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
      .parse(request.query ?? {})

    const [steps, events] = await Promise.all([q.funnel(days), q.topEvents(days)])
    const first = steps[0]?.players || 1

    const stepRows = steps.map((step, index) => {
      const share = Math.round((step.players / first) * 100)
      const previous = index > 0 ? steps[index - 1].players : step.players
      const lost = previous - step.players
      return `<tr>
        <td>${esc(step.label)}</td>
        <td style="width:40%"><div class="bar"><i style="width:${share}%"></i></div></td>
        <td class="num">${num(step.players)}</td>
        <td class="num dim">${share}%</td>
        <td class="num ${lost > 0 ? 'neg' : 'dim'}">${index === 0 ? '' : lost > 0 ? `−${num(lost)}` : '0'}</td>
      </tr>`
    })

    const eventRows = events.map(
      (event) => `<tr>
        <td>${esc(event.name)}</td>
        <td class="num">${num(event.count)}</td>
        <td class="num dim">${num(event.players)}</td>
      </tr>`,
    )

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Поведение',
        active: '/admin/funnel',
        admin: request.currentAdmin!,
        body: `
          <h1>Поведение игроков</h1>
          <p class="sub">За последние ${days} дней. Считаются люди, а не открытия:
             один игрок, зашедший десять раз, — это один человек.</p>

          <form class="inline" method="get" action="/admin/funnel" style="margin-bottom:16px">
            <select name="days">
              ${[7, 30, 90]
                .map((d) => `<option value="${d}" ${days === d ? 'selected' : ''}>${d} дней</option>`)
                .join('')}
            </select>
            <button>Показать</button>
          </form>

          <h2>Путь новичка</h2>
          ${table(['Шаг', '', '#Игроков', '#Доля', '#Отвалилось'], stepRows)}

          <h2>События</h2>
          <p class="sub">Сырой список того, что приложение сообщает серверу.</p>
          ${table(['Событие', '#Всего', '#Игроков'], eventRows)}
        `,
      }),
    )
  })

  // ─── Экономика ─────────────────────────────────────────────────────────────

  app.get('/admin/config', { preHandler: requireAdmin }, async (request, reply) => {
    const saved = (request.query as { saved?: string }).saved
    const rows = await q.appConfig()

    const body = rows.map(
      (row) => `<tr>
        <td><code>${esc(row.key)}</code><br><span class="dim">${esc(row.description ?? '')}</span></td>
        <td>
          <form class="inline" method="post" action="/admin/config">
            <input type="hidden" name="key" value="${esc(row.key)}">
            <input name="value" value="${esc(row.value)}" style="width:120px" required>
            <button class="ghost">Сохранить</button>
          </form>
        </td>
        <td class="dim">${when(row.updated_at)}</td>
      </tr>`,
    )

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Экономика',
        active: '/admin/config',
        admin: request.currentAdmin!,
        body: `
          <h1>Параметры экономики</h1>
          <p class="sub">Меняются на живую: приложение забирает их при каждом входе.
             Пересобирать ничего не нужно.</p>
          ${saved ? `<div class="note">Сохранено: <code>${esc(saved)}</code></div>` : ''}
          <div class="note warn">Эти числа — деньги игроков. Каждая правка попадает
             в журнал: видно, кто и когда её сделал.</div>
          ${table(['Параметр', 'Значение', 'Изменён'], body)}
        `,
      }),
    )
  })

  app.post('/admin/config', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .object({ key: z.string().min(1).max(64), value: z.string().min(1).max(32) })
      .safeParse(request.body)

    if (!parsed.success) return reply.redirect('/admin/config')

    const numeric = Number(parsed.data.value)
    if (!Number.isFinite(numeric) || numeric < 0) return reply.redirect('/admin/config')

    const before = await q.appConfig()
    const previous = before.find((row) => row.key === parsed.data.key)
    if (!previous) return reply.redirect('/admin/config')

    await query(
      'UPDATE app_config SET value = $2::jsonb, updated_by = $3, updated_at = now() WHERE key = $1',
      [parsed.data.key, JSON.stringify(numeric), request.currentAdmin!.id],
    )
    invalidateEconomyCache()
    await getEconomyConfig(true)

    await audit(
      request.currentAdmin!.id,
      'config_change',
      { type: 'app_config', id: null },
      {
        before: { [parsed.data.key]: previous.value },
        after: { [parsed.data.key]: numeric },
        ip: request.ip,
      },
    )

    return reply.redirect(`/admin/config?saved=${encodeURIComponent(parsed.data.key)}`)
  })

  // ─── Журнал действий ───────────────────────────────────────────────────────

  app.get('/admin/audit', { preHandler: requireAdmin }, async (request, reply) => {
    const { page } = z
      .object({ page: z.coerce.number().int().min(0).default(0) })
      .parse(request.query ?? {})

    const { rows, hasMore } = await q.auditLog(page)

    const body = rows.map(
      (row) => `<tr>
        <td>${esc(row.admin)}</td>
        <td>${esc(row.action)}</td>
        <td>${
          row.target_type === 'user' && row.target_id
            ? `<a href="/admin/players/${row.target_id}">игрок #${row.target_id}</a>`
            : esc(row.target_type ?? '')
        }</td>
        <td class="dim">${esc(JSON.stringify(row.before ?? ''))} → ${esc(JSON.stringify(row.after ?? ''))}</td>
        <td class="dim">${esc(row.comment ?? '')}</td>
        <td class="dim">${when(row.created_at)}</td>
      </tr>`,
    )

    return reply.type('text/html; charset=utf-8').send(
      layout({
        title: 'Журнал',
        active: '/admin/audit',
        admin: request.currentAdmin!,
        body: `
          <h1>Журнал действий</h1>
          <p class="sub">Что делали администраторы. Хранится «было» и «стало»,
             чтобы ошибку можно было найти и откатить.</p>
          ${table(['Кто', 'Действие', 'Над чем', 'Было → стало', 'Комментарий', 'Когда'], body)}
          ${pager('/admin/audit', page, hasMore)}
        `,
      }),
    )
  })
}
