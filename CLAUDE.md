# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two-part system for MetaShip support automation:
1. **Node.js Pipeline** — Ticket ingestion from Omnidesk + analytics/reporting
2. **Python AI Agent** — LangChain-based agent with RAG for auto-generating draft responses

## Commands

### Node.js (ingestion & analytics)

```bash
npm install
npm run ingest                       # Fetch tickets to Supabase
npm run ingest -- --dry-run          # Preview without DB writes
npm run ingest -- --enrich-users     # Fetch user details (slower)

# Analytics
node analytics.js                    # Basic stats
node analytics-weekly-comparison.js  # Week-over-week
node analytics-by-client.js          # Per-client
node analytics-by-delivery.js        # Per-carrier
node report-monthly-deep.js          # Full monthly with classification
node report-last-week.js             # Last 7 days

# FAQ generation
node faq-builder.js                  # Generate FAQ from tickets
node faq-research.js                 # Research patterns
```

### Python AI Agent (`agent/`)

```bash
cd agent
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Index FAQ to pgvector
python index_faq.py                  # Index faq-data.json
python index_faq.py --clear          # Clear and reindex
python index_faq.py --test "query"   # Test search

# Run server
uvicorn main:app --reload --port 8000

# API endpoints
# GET  /              - Web UI (Glass Morphism design)
# GET  /tickets/recent - Get recent tickets from Supabase
# POST /generate      - Generate draft response
# POST /classify      - Classify question only
# POST /search        - Search FAQ directly
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ DATA PIPELINE (Node.js)                                         │
│ Omnidesk API → ingest-tickets.js → Supabase → analytics → reports│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ AI AGENT (Python/FastAPI)                                       │
│ Ticket → /generate → Classify → RAG(pgvector) → LLM → Draft    │
│                                                    ↓            │
│                                               Telegram notify   │
└─────────────────────────────────────────────────────────────────┘
```

### Node.js Pipeline

1. **Ingestion** (`ingest-tickets.js`): Fetches tickets with pagination, extracts first message, upserts to Supabase
2. **Analytics** (`analytics*.js`, `report-*.js`): Queries Supabase, regex-based issue classification
3. **Automation**: n8n workflows for scheduled execution (see `n8n-*.json`)

### Python Agent Components

| File | Purpose |
|------|---------|
| `main.py` | FastAPI server with `/generate`, `/classify`, `/search`, `/tickets/recent` endpoints |
| `static/index.html` | Web UI with Inbox panel for recent tickets + draft generation |
| `agent.py` | LangChain agent with tool calling, RAG context injection |
| `vectorstore.py` | Supabase pgvector integration for FAQ embeddings |
| `tools.py` | Agent tools: search_faq, check_order_status, get_delivery_points |
| `prompts.py` | System prompts for classification and response generation |
| `config.py` | Pydantic settings from environment |

### Key Patterns

**API Rate Limiting**: 150ms delay between Omnidesk requests. Exponential backoff on 429 (2s, 4s, 6s).

**Deduplication**: Supabase upsert with `onConflict: 'ticket_id'`.

**LLM Provider**: Agent supports OpenAI or Anthropic via `LLM_PROVIDER` env var.

**RAG Flow**: Question → embed → pgvector similarity search → inject context → LLM generates response.

**Web UI Flow**: Load recent tickets from Supabase → Select ticket or quick-draft → Generate response → Copy to clipboard.

### Database Schema

Main tables:
- `support_tickets` — Ingested tickets (see `schema-v2.sql`)
- `faq_embeddings` — pgvector for RAG (see `agent/README.md`)
- `ai_responses_log` — Agent response logging (see `schema-ai-agent.sql`)

Key views: `tickets_last_week`, `client_stats`, `channel_stats`

### Issue Classification

`report-monthly-deep.js` uses regex patterns in `SYSTEM_ERRORS`:
- Critical: Order creation errors, timeouts, auth failures
- High: ПВЗ not found, tariff unavailable, status sync
- Medium: Webhooks, labels/documents, validation, tracking, returns

Carrier detection via `extractDS()`: СДЕК, Dalli, Почта России, DPD, 5Post, Boxberry, Яндекс Доставка, etc.

## Environment Variables

### Node.js (`.env`)
```
OMNIDESK_SUBDOMAIN=pimpay
OMNIDESK_EMAIL=...
OMNIDESK_API_TOKEN=...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### Python Agent (`agent/.env`)
```
# LLM (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...  # Alternative
LLM_PROVIDER=openai           # or "anthropic"
LLM_MODEL=gpt-4o-mini         # or claude model

# Supabase (same as Node.js)
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Optional
METASHIP_API_TOKEN=...        # For order status tool
TELEGRAM_BOT_TOKEN=...        # Draft notifications
TELEGRAM_CHAT_ID=...
```

## n8n Integration

See `n8n-setup-guide.md` and `AI-AGENT-SETUP.md` for workflow configuration.
- `n8n-final-workflow.json` — Production workflow
- `n8n-ai-support-agent.json` — AI agent integration workflow
