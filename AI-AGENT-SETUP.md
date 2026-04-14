# AI Support Agent - Инструкция по настройке

## Обзор

AI Support Agent автоматически генерирует черновики ответов на тикеты поддержки MetaShip.

**Архитектура:**
```
Webhook/Manual → Extract → Search FAQ → Build Prompt → AI Generate → Send to Telegram
                                                                  → Log to Supabase
```

**Возможности:**
- Классификация вопросов по категориям (СД, API, ЛК, ошибки)
- Поиск релевантной информации из FAQ
- Генерация черновика ответа через GPT-4o-mini
- Определение необходимости эскалации
- Отправка черновика оператору в Telegram
- Логирование для аналитики качества

---

## 1. Подготовка базы данных

Выполните SQL в Supabase:

```bash
# Файл: schema-ai-agent.sql
```

Создаст:
- Таблицу `ai_responses_log` для логирования
- Views для аналитики качества ответов

---

## 2. Импорт workflow в n8n

1. Откройте n8n: `http://your-n8n-instance`
2. **Import Workflow** → вставьте содержимое `n8n-ai-support-agent.json`
3. Workflow появится как "MetaShip AI Support Agent"

---

## 3. Настройка credentials

### OpenAI API
1. n8n → **Credentials** → **New** → **OpenAI API**
2. Вставьте API Key от OpenAI
3. Замените `REPLACE_WITH_YOUR_CREDENTIAL_ID` в ноде "AI - Generate Response"

### Telegram Bot
1. Создайте бота через @BotFather → получите токен
2. Узнайте chat_id для отправки (можно через @userinfobot)
3. n8n → **Credentials** → **New** → **Telegram API**
4. Замените в ноде "Telegram - Send to Operator":
   - credential ID
   - `chatId`: ваш chat_id или ID группы

### Supabase (опционально, для логирования)
1. n8n → **Credentials** → **New** → **Supabase API**
2. URL: `https://xxx.supabase.co`
3. Service Role Key из настроек проекта
4. Замените credential ID в ноде "Supabase - Log Response"

---

## 4. Настройка триггера

### Вариант A: Webhook (рекомендуется)

1. Активируйте workflow → скопируйте Webhook URL
2. В Omnidesk настройте отправку событий на этот URL
3. Формат payload:
```json
{
  "case_id": "123456",
  "subject": "Тема тикета",
  "content": "Текст вопроса клиента",
  "user_name": "Имя клиента",
  "channel": "email"
}
```

### Вариант B: Polling (альтернатива)

Добавьте Schedule Trigger + HTTP Request к Omnidesk API для polling новых тикетов.

---

## 5. Тестирование

1. Откройте workflow → нажмите **Execute Workflow**
2. Manual Trigger запустит тест с пустыми данными
3. Или отправьте POST на webhook:

```bash
curl -X POST https://your-n8n/webhook/support-ticket \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "test-001",
    "subject": "Не создается заказ через API",
    "content": "Добрый день! При создании заказа через API получаю ошибку 500. Что делать?",
    "user_name": "Тест Клиент"
  }'
```

---

## 6. Мониторинг качества

После накопления данных смотрите метрики:

```sql
-- Общая статистика
SELECT * FROM ai_agent_metrics ORDER BY day DESC LIMIT 7;

-- По категориям
SELECT * FROM ai_agent_category_metrics;

-- Последние ответы
SELECT ticket_id, categories, needs_escalation, was_used, feedback_score
FROM ai_responses_log
ORDER BY generated_at DESC
LIMIT 20;
```

---

## 7. Улучшение FAQ базы

Для повышения качества ответов:

1. Добавляйте новые паттерны в `Search FAQ` ноду
2. Расширяйте `typical_answers` по категориям
3. Помечайте `escalation_keywords` для сложных случаев

Пример добавления категории:
```javascript
// В Search FAQ → keywords
"boxberry|боксберри": "СД: Boxberry",

// В categories
"СД: Boxberry": {
  "typical_answers": [
    "Для Boxberry используется тариф...",
    "ПВЗ Boxberry можно найти..."
  ],
  "escalation_keywords": ["не работает boxberry"]
}
```

---

## Troubleshooting

**Ответ не генерируется:**
- Проверьте OpenAI credentials
- Проверьте лимиты API

**Telegram не отправляет:**
- Проверьте chat_id (число, не строка для групп с минусом)
- Бот должен быть добавлен в чат/группу

**Неправильная категоризация:**
- Добавьте больше ключевых слов в `keywords`
- Проверьте regex паттерны

---

## Следующие шаги (roadmap)

1. [ ] Добавить vector search для FAQ (pgvector)
2. [ ] Интеграция с Omnidesk для автоответа
3. [ ] Feedback loop от операторов
4. [ ] A/B тестирование промптов
5. [ ] Дашборд качества в Supabase
