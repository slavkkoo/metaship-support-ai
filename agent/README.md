# MetaShip Support AI Agent

LangChain-based AI agent для автоматической генерации ответов на тикеты поддержки.

## Возможности

- **RAG (Retrieval Augmented Generation)** — семантический поиск по FAQ
- **Tool Calling** — агент может использовать инструменты (поиск FAQ, проверка статуса заказа)
- **Классификация** — автоматическое определение категории вопроса
- **Эскалация** — определение случаев требующих оператора
- **FastAPI** — REST API для интеграции с n8n или другими системами

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Server                            │
│  POST /generate                                              │
│    ↓                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │  Classify   │ →  │  Retrieve   │ →  │   Agent     │      │
│  │  Question   │    │  Context    │    │  (LLM+Tools)│      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│         ↓                  ↓                  ↓              │
│    Categories        pgvector           Draft Response       │
│                      Supabase                                │
└─────────────────────────────────────────────────────────────┘
```

## Быстрый старт

### 1. Установка

```bash
cd agent
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Настройка

```bash
cp .env.example .env
# Отредактируйте .env, добавьте ключи API
```

### 3. Настройка базы данных

Выполните SQL в Supabase SQL Editor:

```sql
-- Включить pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Создать таблицу для embeddings
CREATE TABLE IF NOT EXISTS faq_embeddings (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_content UNIQUE (content)
);

-- Создать индекс
CREATE INDEX IF NOT EXISTS faq_embeddings_embedding_idx
ON faq_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Создать функцию поиска
CREATE OR REPLACE FUNCTION match_faq_documents(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        faq_embeddings.id,
        faq_embeddings.content,
        faq_embeddings.metadata,
        1 - (faq_embeddings.embedding <=> query_embedding) AS similarity
    FROM faq_embeddings
    WHERE 1 - (faq_embeddings.embedding <=> query_embedding) > match_threshold
    ORDER BY faq_embeddings.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

### 4. Индексация FAQ

```bash
# Проиндексировать faq-data.json
python index_faq.py

# Или с очисткой существующих данных
python index_faq.py --clear

# Тест поиска
python index_faq.py --test "как создать заказ"
```

### 5. Запуск сервера

```bash
# Development
uvicorn main:app --reload --port 8000

# Production
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 6. Тестирование API

```bash
# Health check
curl http://localhost:8000/health

# Генерация ответа
curl -X POST http://localhost:8000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_id": "test-001",
    "question": "Как создать заказ через API?",
    "client_name": "Тест Клиент"
  }'

# Классификация
curl -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_id": "test-002",
    "question": "Ошибка 500 при создании заказа"
  }'

# Поиск по FAQ
curl -X POST "http://localhost:8000/search?query=статус%20заказа&k=3"
```

## Docker

```bash
# Build
docker build -t metaship-support-agent .

# Run
docker run -d \
  --name support-agent \
  -p 8000:8000 \
  --env-file .env \
  metaship-support-agent
```

## Интеграция с n8n

В n8n используйте HTTP Request node:

```
Method: POST
URL: http://localhost:8000/generate
Body (JSON):
{
  "ticket_id": "{{ $json.case_id }}",
  "question": "{{ $json.first_message_text }}",
  "subject": "{{ $json.subject }}",
  "client_name": "{{ $json.user_name }}"
}
```

## API Reference

### POST /generate

Генерация черновика ответа.

**Request:**
```json
{
  "ticket_id": "string",
  "question": "string",
  "subject": "string (optional)",
  "client_name": "string (optional)",
  "channel": "string (optional)"
}
```

**Response:**
```json
{
  "ticket_id": "string",
  "draft_response": "string",
  "categories": ["string"],
  "needs_escalation": false,
  "escalation_reason": null,
  "confidence": 0.85,
  "retrieved_docs_count": 5,
  "generated_at": "2024-01-01T00:00:00Z"
}
```

### POST /classify

Классификация вопроса без генерации ответа.

### POST /search

Прямой поиск по векторной базе FAQ.

## Конфигурация

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `LLM_PROVIDER` | openai или anthropic | openai |
| `LLM_MODEL` | Модель LLM | gpt-4o-mini |
| `RETRIEVAL_K` | Кол-во документов для RAG | 5 |
| `SIMILARITY_THRESHOLD` | Мин. порог схожести | 0.7 |
| `TEMPERATURE` | Температура генерации | 0.3 |

## Инструменты агента

1. **search_faq** — семантический поиск по базе знаний
2. **check_order_status** — проверка статуса заказа по GUID (требует METASHIP_API_TOKEN)
3. **get_delivery_points** — поиск ПВЗ по городу
4. **escalate_to_operator** — пометка для эскалации

## Улучшение качества

1. **Добавление данных в FAQ:**
   - Обновите `faq-data.json` новыми Q&A парами
   - Запустите `python index_faq.py --clear`

2. **Настройка промптов:**
   - Отредактируйте `prompts.py`

3. **Добавление инструментов:**
   - Создайте новый tool в `tools.py`
   - Добавьте в `ALL_TOOLS`

## Мониторинг

Логи пишутся в stdout. Для продакшена рекомендуется:
- Подключить Sentry для ошибок
- Использовать LangSmith для трейсинга LLM
- Настроить Prometheus метрики
