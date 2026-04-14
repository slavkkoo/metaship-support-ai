FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY ingest-daily.js ./
COPY .env ./

# Запуск
CMD ["node", "ingest-daily.js"]
