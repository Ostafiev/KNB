#!/bin/bash
# Двойной клик по этому файлу поднимает игру и даёт адрес для Telegram.
# Без Docker — работает на macOS 12 и новее.
# Остановить: закрыть окно Терминала или нажать Ctrl+C.

set -u
cd "$(dirname "$0")" || exit 1

RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'

# step "что делаю" "зачем это нужно"
step()  { echo; echo "${BOLD}▸ $1${OFF}"; [ -n "${2:-}" ] && echo "${DIM}  $2${OFF}"; }
fail()  { echo; echo "${RED}✗ $1${OFF}"; echo; echo "Пришли мне этот текст — разберёмся."; echo "Нажми Enter, чтобы закрыть."; read -r _; exit 1; }
ok()    { echo "${GREEN}  ✓ $1${OFF}"; }

echo
echo "${BOLD}КНБ — запуск${OFF}"
echo "${DIM}Подниму базу данных, сервер и адрес для Telegram."
echo "Что означает каждый шаг — в файле ЧТО-ПРОИСХОДИТ.md рядом.${OFF}"

# ─── Homebrew ────────────────────────────────────────────────────────────────
step "Проверяю Homebrew" "магазин программ для Терминала — через него ставится всё остальное"
if ! command -v brew >/dev/null 2>&1; then
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$p" ] && eval "$($p shellenv)" && break
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  echo
  echo "Homebrew не установлен. Скопируй строку ниже, вставь в Терминал,"
  echo "введи пароль от компьютера, дождись конца — и запусти этот файл снова:"
  echo
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo
  echo "Нажми Enter, чтобы закрыть."; read -r _; exit 1
fi
ok "Homebrew на месте"

# ─── Программы ───────────────────────────────────────────────────────────────
step "Проверяю программы (первый раз это несколько минут)" "node — исполняет код сервера, postgresql — база, redis — память для матчей, cloudflared — адрес"
for pkg in node postgresql@16 redis cloudflared; do
  if brew list --versions "$pkg" >/dev/null 2>&1; then
    ok "$pkg уже установлен"
  else
    echo "  ставлю $pkg…"
    brew install "$pkg" >/tmp/knb-brew.log 2>&1 || fail "не удалось поставить $pkg. Подробности: /tmp/knb-brew.log"
    ok "$pkg установлен"
  fi
done

PG_BIN="$(brew --prefix)/opt/postgresql@16/bin"
export PATH="$PG_BIN:$PATH"

# ─── Базы данных ─────────────────────────────────────────────────────────────
step "Запускаю базу данных и Redis" "здесь будут храниться игроки, балансы и матчи; окон они не открывают"
brew services start postgresql@16 >/dev/null 2>&1
brew services start redis >/dev/null 2>&1

for i in $(seq 1 30); do
  pg_isready -q -h 127.0.0.1 -p 5432 && break
  sleep 1
done
pg_isready -q -h 127.0.0.1 -p 5432 || fail "база данных не поднялась за 30 секунд"
ok "PostgreSQL отвечает"

redis-cli ping >/dev/null 2>&1 || fail "Redis не отвечает"
ok "Redis отвечает"

psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='knb'" 2>/dev/null | grep -q 1 \
  || psql -d postgres -q -c "CREATE ROLE knb LOGIN PASSWORD 'knb_dev_password'" >/dev/null 2>&1
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='knb'" 2>/dev/null | grep -q 1 \
  || createdb -O knb knb >/dev/null 2>&1
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='knb'" 2>/dev/null | grep -q 1 \
  || fail "не удалось создать базу knb"
ok "База knb готова"

# ─── Настройки ───────────────────────────────────────────────────────────────
step "Проверяю настройки" "файл backend/.env с токеном бота и секретами — в код их вписывать нельзя, утекут в GitHub"
if [ ! -f backend/.env ]; then
  echo
  echo "Нужен токен бота из @BotFather (длинная строка с двоеточием)."
  printf "Вставь его сюда и нажми Enter: "
  read -r TOKEN
  [ -z "$TOKEN" ] && fail "без токена бота вход через Telegram работать не будет"
  cp backend/.env.example backend/.env || fail "нет файла backend/.env.example"
  A="$(openssl rand -base64 32)"; B="$(openssl rand -base64 32)"
  /usr/bin/sed -i '' \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://knb:knb_dev_password@127.0.0.1:5432/knb|" \
    -e "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TOKEN|" \
    -e "s|^ADMIN_SESSION_SECRET=.*|ADMIN_SESSION_SECRET=$A|" \
    -e "s|^AUTH_TOKEN_SECRET=.*|AUTH_TOKEN_SECRET=$B|" \
    backend/.env || fail "не удалось записать backend/.env"
  ok "backend/.env создан"
else
  ok "backend/.env уже есть"
fi

# ─── Сборка ──────────────────────────────────────────────────────────────────
step "Собираю приложение" "скачиваю готовые библиотеки, склеиваю экраны в один файл для браузера и обновляю структуру базы"
(cd backend && npm install --no-audit --no-fund >/tmp/knb-npm-back.log 2>&1) \
  || fail "npm install в backend не прошёл. Подробности: /tmp/knb-npm-back.log"
ok "сервер собран"

(cd frontend && npm install --no-audit --no-fund >/tmp/knb-npm-front.log 2>&1 && npm run build >>/tmp/knb-npm-front.log 2>&1) \
  || fail "сборка приложения не прошла. Подробности: /tmp/knb-npm-front.log"
ok "приложение собрано"

(cd backend && npm run migrate >/tmp/knb-migrate.log 2>&1) \
  || fail "миграции не прошли. Подробности: /tmp/knb-migrate.log"
ok "структура базы обновлена"

# ─── Сервер ──────────────────────────────────────────────────────────────────
step "Запускаю сервер" "программа, которая считает раунды и деньги; слушает дверь номер 3000 на этом компьютере"

cleanup() {
  echo; echo "Останавливаю…"
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  BUSY="$(lsof -ti tcp:3000 2>/dev/null)"
  [ -n "$BUSY" ] && kill $BUSY 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Если с прошлого раза остался висеть сервер — освобождаем порт.
BUSY="$(lsof -ti tcp:3000 2>/dev/null)"
if [ -n "$BUSY" ]; then
  kill $BUSY 2>/dev/null
  sleep 2
fi

(cd backend && npm run dev >/tmp/knb-server.log 2>&1) &
SERVER_PID=$!

for i in $(seq 1 40); do
  curl -sf http://localhost:3000/health >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:3000/health >/dev/null 2>&1 \
  || fail "сервер не ответил за 40 секунд. Подробности: /tmp/knb-server.log"
ok "сервер работает: http://localhost:3000"

# ─── Туннель ─────────────────────────────────────────────────────────────────
step "Получаю адрес в интернете" "твой компьютер снаружи не виден — cloudflared делает временный адрес, ведущий на него"
command -v cloudflared >/dev/null 2>&1 \
  || fail "не найден cloudflared. Выполни в Терминале: brew install cloudflared"
: >/tmp/knb-tunnel.log
cloudflared tunnel --url http://localhost:3000 >/tmp/knb-tunnel.log 2>&1 &
TUNNEL_PID=$!

URL=""
for i in $(seq 1 40); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/knb-tunnel.log | head -1)"
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo
  echo "${RED}✗ Туннель не дал адрес — Telegram открыть игру не сможет.${OFF}"
  echo "  Но сервер работает: открой http://localhost:3000 в браузере."
  echo "  Пришли мне первые строчки из /tmp/knb-tunnel.log — разберёмся."
  echo "  Остановить: Ctrl+C."
  echo
  wait $SERVER_PID
  exit 0
fi

echo
echo "${GREEN}${BOLD}═══════════════════════════════════════════════${OFF}"
echo "${BOLD}  Адрес для BotFather:${OFF}"
echo
echo "  ${GREEN}${BOLD}$URL${OFF}"
echo
echo "${GREEN}${BOLD}═══════════════════════════════════════════════${OFF}"
echo
echo "  @BotFather → /mybots → твой бот → Bot Settings →"
echo "  Menu Button → Configure menu button → вставить адрес."
echo
echo "  Это окно не закрывай — пока оно открыто, игра работает."
echo "  Остановить: Ctrl+C."
echo

wait $SERVER_PID
