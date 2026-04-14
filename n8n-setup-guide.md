# Инструкция по настройке n8n для анализа тикетов

## Обзор архитектуры

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         n8n WORKFLOW                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │ Schedule │───▶│ OmniDesk │───▶│ Supabase │───▶│ AI Agent         │  │
│  │ Trigger  │    │ HTTP     │    │ Upsert   │    │ (Weekly Analyst) │  │
│  │ (Weekly) │    │ Request  │    │          │    │                  │  │
│  └──────────┘    └──────────┘    └──────────┘    └────────┬─────────┘  │
│                                                            │            │
│                                                            ▼            │
│                                                   ┌──────────────────┐  │
│                                                   │ Output: Telegram │  │
│                                                   │ / Email / Slack  │  │
│                                                   └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Workflow 1: Загрузка тикетов из OmniDesk в Supabase

### Шаг 1: Schedule Trigger (Расписание)

**Нода:** `Schedule Trigger`

**Настройки:**
- **Trigger Times:**
  - Mode: `Every Week`
  - Day of Week: `Monday`
  - Hour: `9`
  - Minute: `0`
  - Timezone: `Europe/Moscow`

```json
{
  "rule": {
    "interval": [
      {
        "field": "weeks",
        "weeksInterval": 1,
        "triggerAtDay": ["monday"],
        "triggerAtHour": 9,
        "triggerAtMinute": 0
      }
    ]
  }
}
```

---

### Шаг 2: Настройка дат (Code Node)

**Нода:** `Code`

**Название:** `Set Date Range`

**JavaScript код:**
```javascript
// Получаем даты за прошлую неделю
const now = new Date();
const weekAgo = new Date();
weekAgo.setDate(now.getDate() - 7);

// Форматируем для API
const formatDate = (d) => d.toISOString().split('T')[0];

return [{
  json: {
    week_start: formatDate(weekAgo),
    week_end: formatDate(now),
    cutoff_timestamp: weekAgo.toISOString()
  }
}];
```

---

### Шаг 3: Получение списка тикетов (HTTP Request)

**Нода:** `HTTP Request`

**Название:** `OmniDesk - Get Cases List`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Method | `GET` |
| URL | `https://pimpay.omnidesk.ru/api/cases.json` |
| Authentication | `Generic Credential Type` → `Basic Auth` |
| Query Parameters | См. ниже |

**Query Parameters:**
| Name | Value |
|------|-------|
| `limit` | `100` |
| `page` | `{{ $json.page || 1 }}` |
| `sort` | `created_at` |
| `order` | `desc` |

**Credentials (Basic Auth):**
- **User:** `{{ $credentials.omnideskEmail }}`
- **Password:** `{{ $credentials.omnideskApiToken }}`

**Создание Credentials:**
1. Перейти в **Credentials** → **Add Credential**
2. Выбрать **Basic Auth**
3. Name: `OmniDesk API`
4. User: `alexander.kuznetsov@pimpay.ru`
5. Password: `fecba665ceef51705ff95cccc`

---

### Шаг 4: Парсинг ответа OmniDesk (Code Node)

**Нода:** `Code`

**Название:** `Parse OmniDesk Response`

**JavaScript код:**
```javascript
// OmniDesk возвращает объект с числовыми ключами: {"0": {"case": {...}}, "1": {...}}
const response = $input.first().json;
const cutoffDate = new Date($('Set Date Range').first().json.cutoff_timestamp);

// Конвертируем в массив
const cases = [];
const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));

for (const key of keys) {
  const caseData = response[key].case || response[key];
  const createdAt = new Date(caseData.created_at);

  // Фильтруем по дате
  if (createdAt >= cutoffDate) {
    cases.push({
      ticket_id: caseData.case_id,
      created_at: caseData.created_at,
      closed_at: caseData.closed_at !== '-' ? caseData.closed_at : null,
      status: caseData.status,
      priority: caseData.priority,
      channel: caseData.channel,
      subject: caseData.subject,
      labels: caseData.labels || [],
      closing_speed: caseData.closing_speed !== '-' ? parseInt(caseData.closing_speed) : null
    });
  }
}

// Возвращаем каждый тикет как отдельный item для Loop
return cases.map(ticket => ({ json: ticket }));
```

---

### Шаг 5: Получение первого сообщения (Loop + HTTP Request)

**Нода:** `Loop Over Items`

**Название:** `Loop Through Tickets`

**Настройки:**
- Batch Size: `1`

**Внутри Loop — HTTP Request:**

**Нода:** `HTTP Request`

**Название:** `OmniDesk - Get Messages`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Method | `GET` |
| URL | `https://pimpay.omnidesk.ru/api/cases/{{ $json.ticket_id }}/messages.json` |
| Authentication | `Generic Credential Type` → `Basic Auth` |

**Retry on Fail:**
- Retry On Fail: `true`
- Max Tries: `3`
- Wait Between Tries: `2000` ms

---

### Шаг 6: Извлечение первого сообщения (Code Node)

**Нода:** `Code`

**Название:** `Extract First Message`

**JavaScript код:**
```javascript
const ticket = $('Loop Through Tickets').first().json;
const messagesResponse = $input.first().json;

// Парсим сообщения (формат: {"0": {"message": {...}}, ...})
let firstMessageText = null;

try {
  const keys = Object.keys(messagesResponse).filter(k => !isNaN(parseInt(k)));

  if (keys.length > 0) {
    // Сортируем по created_at и берём первое
    const messages = keys
      .map(k => messagesResponse[k].message || messagesResponse[k])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const firstMsg = messages[0];
    firstMessageText = firstMsg.content || firstMsg.content_text || firstMsg.text || null;
  }
} catch (e) {
  console.log('Error parsing messages:', e.message);
}

// Форматируем дату для Supabase
const parseDate = (dateStr) => {
  if (!dateStr || dateStr === '-') return null;
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return null;
  }
};

return [{
  json: {
    ticket_id: ticket.ticket_id,
    created_at: parseDate(ticket.created_at),
    closed_at: parseDate(ticket.closed_at),
    status: ticket.status,
    priority: ticket.priority,
    channel: ticket.channel,
    subject: ticket.subject,
    first_message_text: firstMessageText,
    labels: ticket.labels.length > 0 ? ticket.labels : null,
    closing_speed: ticket.closing_speed
  }
}];
```

---

### Шаг 7: Задержка для Rate Limit (Wait Node)

**Нода:** `Wait`

**Название:** `Rate Limit Delay`

**Настройки:**
- Wait Time: `300` milliseconds

---

### Шаг 8: Запись в Supabase (Supabase Node)

**Нода:** `Supabase`

**Название:** `Upsert to Supabase`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Resource | `Row` |
| Operation | `Upsert` |
| Table Name | `support_tickets` |
| Conflict Fields | `ticket_id` |

**Credentials (Supabase):**
1. Перейти в **Credentials** → **Add Credential**
2. Выбрать **Supabase API**
3. Host: `https://kzukrvyhpwpmljuhifcm.supabase.co`
4. Service Role Secret: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6dWtydnlocHdwbWxqdWhpZmNtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDQ0MTY1NywiZXhwIjoyMDg2MDE3NjU3fQ.CiSPpc--6zg2ULKlRILiOw0w56tifoUoiIM4UH-GcGY`

**Mapping полей:**
| Supabase Column | Value |
|-----------------|-------|
| ticket_id | `{{ $json.ticket_id }}` |
| created_at | `{{ $json.created_at }}` |
| closed_at | `{{ $json.closed_at }}` |
| status | `{{ $json.status }}` |
| priority | `{{ $json.priority }}` |
| channel | `{{ $json.channel }}` |
| subject | `{{ $json.subject }}` |
| first_message_text | `{{ $json.first_message_text }}` |
| labels | `{{ $json.labels }}` |
| closing_speed | `{{ $json.closing_speed }}` |

---

## Workflow 2: AI Agent для анализа тикетов

### Шаг 1: Trigger после загрузки

**Вариант A:** Подключить к концу Workflow 1

**Вариант B:** Отдельный Schedule Trigger (Monday 10:00)

---

### Шаг 2: Получение тикетов из Supabase (Supabase Node)

**Нода:** `Supabase`

**Название:** `Get Weekly Tickets`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Resource | `Row` |
| Operation | `Get Many` |
| Table Name | `support_tickets` |
| Return All | `true` |

**Filters:**
```
created_at >= {{ $now.minus({days: 7}).toISO() }}
```

---

### Шаг 3: Подготовка данных для AI (Code Node)

**Нода:** `Code`

**Название:** `Prepare AI Input`

**JavaScript код:**
```javascript
const tickets = $input.all().map(item => item.json);

const now = new Date();
const weekAgo = new Date();
weekAgo.setDate(now.getDate() - 7);

const inputData = {
  week_start_date: weekAgo.toISOString().split('T')[0],
  week_end_date: now.toISOString().split('T')[0],
  tickets: tickets.map(t => ({
    ticket_id: String(t.ticket_id),
    created_at: t.created_at,
    closed_at: t.closed_at,
    status: t.status,
    priority: t.priority,
    channel: t.channel,
    subject: t.subject,
    first_message_text: t.first_message_text,
    labels: t.labels,
    closing_speed: t.closing_speed
  }))
};

return [{
  json: {
    ticketCount: tickets.length,
    inputJson: JSON.stringify(inputData, null, 2)
  }
}];
```

---

### Шаг 4: AI Agent (OpenAI / Anthropic)

**Нода:** `AI Agent` или `OpenAI` / `Anthropic`

**Название:** `Weekly Support Analyst`

#### Вариант A: Использование ноды OpenAI

**Нода:** `OpenAI`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Resource | `Chat` |
| Operation | `Message a Model` |
| Model | `gpt-4o` или `gpt-4-turbo` |
| Max Tokens | `8000` |
| Temperature | `0.3` |

**Credentials:**
1. **Credentials** → **Add Credential** → **OpenAI API**
2. API Key: ваш OpenAI API ключ

---

#### Вариант B: Использование ноды Anthropic (Claude)

**Нода:** `HTTP Request`

**Название:** `Claude AI Analysis`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Method | `POST` |
| URL | `https://api.anthropic.com/v1/messages` |
| Authentication | `Generic Credential Type` → `Header Auth` |

**Headers:**
| Name | Value |
|------|-------|
| `x-api-key` | `{{ $credentials.anthropicApiKey }}` |
| `anthropic-version` | `2023-06-01` |
| `content-type` | `application/json` |

**Body (JSON):**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8000,
  "messages": [
    {
      "role": "user",
      "content": "{{ $json.systemPrompt }}\n\nINPUT DATA:\n{{ $json.inputJson }}"
    }
  ]
}
```

---

### Шаг 5: System Prompt для AI Agent

**Нода:** `Code` (перед AI)

**Название:** `Build AI Prompt`

**JavaScript код:**
```javascript
const inputJson = $input.first().json.inputJson;

const systemPrompt = `You are "Weekly Support Insights Analyst" for MetaShip.

You analyze ONLY the provided support tickets for a single week and produce:
1) Executive summary (one screen)
2) Top 3 risks (based only on the week's tickets)
3) Issue clusters (problem types) with evidence
4) Product recommendations (MetaShip-side actions)
5) Operational actions (internal support/process actions)
6) Top clients by ticket volume
7) Clear limitations due to missing history

HARD RULES:
1) No hallucinations. Do not invent data beyond what you can count from input.
2) No baseline / deltas. Set delta fields to "insufficient_data".
3) Every insight/risk MUST cite evidence with ticket_ids (at least 3 for medium+).
4) Redact PII: phone/email/order numbers as "[REDACTED]".
5) Output ONLY valid JSON matching the schema below.

CLUSTER NAMING (use these metric_keys):
- delivery_point_not_found
- order_creation_validation_errors
- api_integration_questions
- status_sync_issues
- bitrix_module_issues
- tariff_calculation_errors
- pickup_and_intake_issues

SEVERITY RUBRIC:
- critical: repeated pattern + strong customer impact + systemic failure (many tickets)
- high: recurring issue with meaningful impact (multiple tickets, clear pain)
- medium: noticeable issue but limited scope
- low: minor UX confusion, singletons

OUTPUT JSON SCHEMA:
{
  "report_metadata": { "week_start_date": "...", "week_end_date": "...", "total_tickets_analyzed": N },
  "executive_summary": { "one_liner": "...", "key_stats": {...}, "top_issues": [...] },
  "top_3_risks": [{ "title": "...", "severity": "...", "evidence_ticket_ids": [...], ... }],
  "insights": [{ "metric_key": "...", "title": "...", "ticket_count": N, "evidence_ticket_ids": [...], ... }],
  "top_clients_analysis": { "clients": [{ "client_name": "...", "ticket_count": N, ... }] },
  "limitations": [...]
}

Respond with ONLY the JSON, no markdown code blocks.`;

return [{
  json: {
    systemPrompt: systemPrompt,
    inputJson: inputJson
  }
}];
```

---

### Шаг 6: Парсинг ответа AI (Code Node)

**Нода:** `Code`

**Название:** `Parse AI Response`

**JavaScript код:**
```javascript
const response = $input.first().json;

// Для OpenAI
let content = response.choices?.[0]?.message?.content;

// Для Anthropic
if (!content) {
  content = response.content?.[0]?.text;
}

// Парсим JSON
let report;
try {
  // Убираем возможные markdown блоки
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  report = JSON.parse(content);
} catch (e) {
  return [{
    json: {
      error: 'Failed to parse AI response',
      raw_content: content
    }
  }];
}

return [{
  json: {
    report: report,
    generated_at: new Date().toISOString()
  }
}];
```

---

### Шаг 7: Форматирование отчёта для отправки (Code Node)

**Нода:** `Code`

**Название:** `Format Report for Notification`

**JavaScript код:**
```javascript
const report = $input.first().json.report;
const meta = report.report_metadata;
const summary = report.executive_summary;
const risks = report.top_3_risks || [];
const clients = report.top_clients_analysis?.clients || [];

// Форматируем для Telegram (Markdown)
let message = `📊 *Weekly Support Report*
📅 ${meta.week_start_date} — ${meta.week_end_date}

*Summary:* ${summary.one_liner}

📈 *Key Stats:*
• Total tickets: ${summary.key_stats?.total_tickets || meta.total_tickets_analyzed}
• Closed: ${summary.key_stats?.closed_tickets || 'N/A'}
• Avg resolution: ${summary.key_stats?.avg_closing_speed_minutes || 'N/A'} min

🚨 *Top 3 Risks:*
`;

risks.forEach((risk, i) => {
  const emoji = risk.severity === 'critical' ? '🔴' : risk.severity === 'high' ? '🟠' : '🟡';
  message += `${i+1}. ${emoji} *${risk.title}* (${risk.severity})\n`;
});

message += `\n👥 *Top Clients:*\n`;
clients.slice(0, 5).forEach((c, i) => {
  message += `${i+1}. ${c.client_name}: ${c.ticket_count} tickets\n`;
});

message += `\n📋 *Top Issues:*\n`;
(summary.top_issues || []).slice(0, 5).forEach((issue, i) => {
  message += `• ${issue}\n`;
});

return [{
  json: {
    telegram_message: message,
    full_report: report
  }
}];
```

---

### Шаг 8: Отправка в Telegram (Telegram Node)

**Нода:** `Telegram`

**Название:** `Send Report to Telegram`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Resource | `Message` |
| Operation | `Send` |
| Chat ID | `@your_channel` или `123456789` |
| Text | `{{ $json.telegram_message }}` |
| Parse Mode | `Markdown` |

**Credentials:**
1. **Credentials** → **Add Credential** → **Telegram API**
2. Access Token: ваш Telegram Bot Token

---

### Шаг 9: Сохранение отчёта в Supabase (опционально)

**Нода:** `Supabase`

**Название:** `Save Report to Supabase`

**Настройки:**
| Параметр | Значение |
|----------|----------|
| Resource | `Row` |
| Operation | `Insert` |
| Table Name | `weekly_reports` |

**Таблица `weekly_reports` (создать в Supabase):**
```sql
CREATE TABLE weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Полная схема Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WORKFLOW: Weekly Ticket Analysis                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐                                                           │
│  │   Schedule   │                                                           │
│  │   Trigger    │                                                           │
│  │  (Mon 9:00)  │                                                           │
│  └──────┬───────┘                                                           │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │  Set Date    │                                                           │
│  │    Range     │                                                           │
│  └──────┬───────┘                                                           │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐     ┌──────────────┐                                      │
│  │  OmniDesk    │────▶│    Parse     │                                      │
│  │  Get Cases   │     │   Response   │                                      │
│  └──────────────┘     └──────┬───────┘                                      │
│                              │                                               │
│         ┌────────────────────┴────────────────────┐                         │
│         │              LOOP                        │                         │
│         │  ┌──────────────┐    ┌──────────────┐   │                         │
│         │  │  OmniDesk    │───▶│   Extract    │   │                         │
│         │  │ Get Messages │    │ First Msg    │   │                         │
│         │  └──────────────┘    └──────┬───────┘   │                         │
│         │                             │           │                         │
│         │                      ┌──────▼───────┐   │                         │
│         │                      │    Wait      │   │                         │
│         │                      │   300ms      │   │                         │
│         │                      └──────────────┘   │                         │
│         └────────────────────────────┬────────────┘                         │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │   Supabase   │                              │
│                               │    Upsert    │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│  ════════════════════════════════════╪══════════════════════════════════    │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │   Supabase   │                              │
│                               │  Get Tickets │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │  Prepare AI  │                              │
│                               │    Input     │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │  Build AI    │                              │
│                               │   Prompt     │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │   AI Agent   │                              │
│                               │ (OpenAI/     │                              │
│                               │  Claude)     │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │    Parse     │                              │
│                               │  AI Response │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│                               ┌──────▼───────┐                              │
│                               │   Format     │                              │
│                               │   Report     │                              │
│                               └──────┬───────┘                              │
│                                      │                                       │
│                    ┌─────────────────┼─────────────────┐                    │
│                    │                 │                 │                    │
│             ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐           │
│             │   Telegram   │  │    Email     │  │   Supabase   │           │
│             │    Send      │  │    Send      │  │ Save Report  │           │
│             └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Настройка Credentials в n8n

### 1. OmniDesk (Basic Auth)

| Поле | Значение |
|------|----------|
| Name | `OmniDesk API` |
| User | `alexander.kuznetsov@pimpay.ru` |
| Password | `fecba665ceef51705ff95cccc` |

### 2. Supabase

| Поле | Значение |
|------|----------|
| Name | `Supabase MetaShip` |
| Host | `https://kzukrvyhpwpmljuhifcm.supabase.co` |
| Service Role Secret | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

### 3. OpenAI (если используется)

| Поле | Значение |
|------|----------|
| Name | `OpenAI API` |
| API Key | `sk-...` |

### 4. Anthropic (если используется)

| Поле | Значение |
|------|----------|
| Name | `Anthropic API` |
| API Key | `sk-ant-...` |

### 5. Telegram

| Поле | Значение |
|------|----------|
| Name | `Telegram Bot` |
| Access Token | `123456789:ABC...` |

---

## Пагинация OmniDesk (расширенная версия)

Для обработки большого количества тикетов используйте **Loop** с пагинацией:

**Нода:** `Code` — `Pagination Controller`

```javascript
// Инициализация или получение текущей страницы
const currentPage = $input.first().json.nextPage || 1;
const maxPages = 50;
const allTickets = $input.first().json.collectedTickets || [];

// Проверяем условие остановки
const lastResponse = $input.first().json.lastApiResponse;
if (lastResponse) {
  const keys = Object.keys(lastResponse).filter(k => !isNaN(parseInt(k)));

  // Если меньше 100 тикетов — последняя страница
  if (keys.length < 100 || currentPage >= maxPages) {
    return [{
      json: {
        done: true,
        tickets: allTickets
      }
    }];
  }
}

return [{
  json: {
    done: false,
    page: currentPage,
    nextPage: currentPage + 1,
    collectedTickets: allTickets
  }
}];
```

---

## Troubleshooting

### Ошибка 429 (Rate Limit)

**Решение:** Увеличьте `Wait` ноду до 500-1000ms

### Ошибка парсинга JSON от AI

**Решение:** Добавьте в prompt:
```
IMPORTANT: Output ONLY valid JSON. No markdown, no explanations, no code blocks.
```

### Timeout при большом количестве тикетов

**Решение:**
1. Увеличьте timeout в настройках workflow
2. Разбейте на batch по 50 тикетов

### Пустой ответ от OmniDesk

**Проверьте:**
1. Credentials (email:api_token)
2. Subdomain (pimpay)
3. URL формат

---

## Запуск и тестирование

1. **Импортируйте workflow** в n8n
2. **Настройте credentials** для всех сервисов
3. **Запустите вручную** для теста (кнопка "Execute Workflow")
4. **Проверьте результаты** каждой ноды
5. **Активируйте** автоматический запуск по расписанию

---

## Файлы для экспорта

После настройки workflow, экспортируйте его:
1. **Workflow** → **Download**
2. Сохраните JSON файл как бэкап

