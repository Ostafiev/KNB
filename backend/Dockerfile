# Сборка
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Запуск
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# Миграции — обычные .sql, в сборку TypeScript они не попадают, копируем отдельно
COPY --from=build /app/src/db/migrations ./dist/db/migrations

# Не работаем из-под root
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
