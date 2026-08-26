/**
 * Разметка админки.
 *
 * Страницы собираются на сервере и приходят готовым HTML. Ни сборки, ни
 * фреймворка, ни библиотек с чужих адресов: панель должна открываться даже
 * тогда, когда всё остальное сломалось, — за этим в неё и заходят.
 *
 * Формы обычные, переходы обычными ссылками. Это осознанно скучно.
 */

/** Экранирование. Любая строка из базы проходит через него. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLE = `
:root {
  --bg: #17212b; --panel: #1c2733; --panel2: #232e3c; --line: #2b3a4a;
  --text: #e8edf2; --dim: #7d8b99; --blue: #2a9fd6; --blue-light: #64d2ff;
  --green: #2aca5c; --red: #e55252; --yellow: #d6b32a;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
a { color: var(--blue-light); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  background: var(--panel); border-bottom: 1px solid var(--line);
  padding: 12px 20px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
}
header .brand { font-weight: 800; font-size: 18px; letter-spacing: -.3px; }
header nav { display: flex; gap: 16px; flex-wrap: wrap; }
header nav a { color: var(--dim); font-weight: 600; font-size: 14px; }
header nav a.active { color: var(--blue-light); }
header .who { margin-left: auto; color: var(--dim); font-size: 13px; }
main { padding: 20px; max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 28px 0 10px; color: var(--dim); font-weight: 600;
     text-transform: uppercase; letter-spacing: .08em; }
.sub { color: var(--dim); font-size: 13px; margin: 0 0 20px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.card .label { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.card .value { font-size: 26px; font-weight: 800; margin-top: 4px; font-variant-numeric: tabular-nums; }
.card .hint { color: var(--dim); font-size: 12px; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 14px; }
th { color: var(--dim); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.pos { color: var(--green); } .neg { color: var(--red); } .dim { color: var(--dim); }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px;
       background: var(--panel2); color: var(--dim); }
.tag.ok { color: var(--green); } .tag.bad { color: var(--red); }
form.inline { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
input, select, textarea {
  background: var(--panel2); border: 1px solid var(--line); color: var(--text);
  border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 14px;
}
input:focus, select:focus, textarea:focus { outline: 2px solid var(--blue); outline-offset: -1px; }
button {
  background: var(--blue); color: #06121a; border: 0; border-radius: 8px;
  padding: 8px 14px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer;
}
button.ghost { background: var(--panel2); color: var(--text); border: 1px solid var(--line); }
button.danger { background: var(--red); color: #fff; }
.row { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
.row > * { flex: 1 1 320px; }
.note { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--blue);
        border-radius: 8px; padding: 12px 14px; color: var(--dim); font-size: 13px; margin: 16px 0; }
.note.warn { border-left-color: var(--yellow); }
.empty { color: var(--dim); padding: 24px; text-align: center; background: var(--panel);
         border: 1px solid var(--line); border-radius: 12px; }
.pager { display: flex; gap: 12px; margin-top: 14px; align-items: center; color: var(--dim); font-size: 13px; }
.bar { height: 8px; background: var(--panel2); border-radius: 999px; overflow: hidden; min-width: 120px; }
.bar > i { display: block; height: 100%; background: linear-gradient(90deg, var(--blue), var(--blue-light)); }
`

const NAV: { href: string; label: string }[] = [
  { href: '/admin', label: 'Сводка' },
  { href: '/admin/players', label: 'Игроки' },
  { href: '/admin/matches', label: 'Матчи' },
  { href: '/admin/transactions', label: 'Операции' },
  { href: '/admin/funnel', label: 'Поведение' },
  { href: '/admin/config', label: 'Экономика' },
  { href: '/admin/audit', label: 'Журнал' },
]

export function layout(options: {
  title: string
  active: string
  admin?: { display_name: string }
  body: string
}): string {
  const nav = NAV.map(
    (item) =>
      `<a href="${item.href}" class="${item.href === options.active ? 'active' : ''}">${esc(item.label)}</a>`,
  ).join('')

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)} · КНБ</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <span class="brand">КНБ</span>
  <nav>${nav}</nav>
  ${
    options.admin
      ? `<span class="who">${esc(options.admin.display_name)} · <a href="/admin/logout">выйти</a></span>`
      : ''
  }
</header>
<main>${options.body}</main>
</body>
</html>`
}

/** Число с разделителями разрядов — чтобы миллионы читались глазами. */
export function num(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return '0'
  return parsed.toLocaleString('ru-RU')
}

export function coins(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0)
  const sign = parsed > 0 ? '+' : ''
  const cls = parsed > 0 ? 'pos' : parsed < 0 ? 'neg' : 'dim'
  return `<span class="${cls}">${sign}${num(parsed)}</span>`
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '<span class="dim">—</span>'
  const date = new Date(iso)
  return esc(
    date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  )
}

export function card(label: string, value: string, hint?: string): string {
  return `<div class="card">
    <div class="label">${esc(label)}</div>
    <div class="value">${value}</div>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
  </div>`
}

export function table(headers: string[], rows: string[]): string {
  if (rows.length === 0) return '<div class="empty">Пока пусто</div>'
  const head = headers
    .map((h) => `<th${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`)
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

/** Постраничная навигация: «дальше» показываем, только если есть что показывать. */
export function pager(path: string, page: number, hasMore: boolean, extra = ''): string {
  const parts: string[] = []
  if (page > 0) parts.push(`<a href="${path}?page=${page - 1}${extra}">← назад</a>`)
  parts.push(`<span>страница ${page + 1}</span>`)
  if (hasMore) parts.push(`<a href="${path}?page=${page + 1}${extra}">дальше →</a>`)
  return `<div class="pager">${parts.join('')}</div>`
}
