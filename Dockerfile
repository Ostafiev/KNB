# Один образ на весь проект: собирает Mini App, собирает сервер,
# и сервер отдаёт приложение сам. Так для проверки нужен один адрес.

# ─── Сборка Mini App ─────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app/frontend

ARG VITE_BOT_USERNAME=knb_bot
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ─── Сборка сервера ──────────────────────────────────────────────────────────
FROM node:22-alpine AS backend
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ─── Запуск ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=backend /app/backend/dist ./dist
# Миграции — обычные .sql, в сборку TypeScript они не попадают
COPY --from=backend /app/backend/src/db/migrations ./dist/db/migrations
# Собранное приложение
COPY --from=frontend /app/frontend/dist ./public
ENV FRONTEND_DIST=./public

USER node
EXPOSE 3000

# Миграции применяются при каждом старте: непринятых нет — команда просто
# ничего не делает, так что отдельный шаг заказчику не нужен.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
