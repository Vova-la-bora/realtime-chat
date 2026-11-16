FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts ./scripts
EXPOSE 3000
# Миграции применяются при старте. node-pg-migrate берёт блокировку: если соседний инстанс
# уже мигрирует, этот ждёт и повторяет попытку, а не падает
CMD ["sh", "-c", "until npm run migrate:up; do echo 'Миграция занята другим инстансом, повтор через 2 с'; sleep 2; done; exec node dist/index.js"]
