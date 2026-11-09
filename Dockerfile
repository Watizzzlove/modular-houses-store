# MODUL.HAUS Production Dockerfile
FROM node:20-slim AS runner

# Установка необходимых системных библиотек для сборки native модулей (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем манифесты зависимостей
COPY package*.json ./

# Устанавливаем зависимости с компиляцией sqlite под целевую архитектуру
RUN npm ci --omit=dev

# Копируем исходный код проекта
COPY . .

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3030

# Том для персистентного хранения базы данных SQLite и логов
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3030

# Запуск приложения
CMD ["node", "server.js"]
