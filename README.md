# MetaShip Support AI

AI-powered support automation system for MetaShip. Combines ticket ingestion from Omnidesk, analytics/reporting, and LangChain-based agent for auto-generating draft responses.

![Glass Morphism UI](https://img.shields.io/badge/UI-Glass%20Morphism-667eea)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![LangChain](https://img.shields.io/badge/LangChain-RAG-orange)

## Features

- **Ticket Ingestion** — Fetch tickets from Omnidesk API, store in Supabase
- **Analytics & Reports** — Weekly comparisons, per-client stats, carrier analysis
- **AI Agent** — LangChain agent with RAG for intelligent draft responses
- **Web UI** — Modern Glass Morphism interface with Inbox panel
- **n8n Integration** — Ready-to-use workflows for automation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ DATA PIPELINE (Node.js)                                         │
│ Omnidesk API → ingest-tickets.js → Supabase → analytics        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ AI AGENT (Python/FastAPI)                                       │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Inbox   │ →  │ Classify │ →  │   RAG    │ →  │   LLM    │  │
│  │ (tickets)│    │ Question │    │ pgvector │    │  Draft   │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                                 │
│  Web UI: http://localhost:8000                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/your-username/metaship-support-ai.git
cd metaship-support-ai

# Node.js dependencies
npm install

# Python dependencies
cd agent
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
# Root .env (Node.js)
cp .env.example .env

# Agent .env (Python)
cp agent/.env.example agent/.env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `OMNIDESK_SUBDOMAIN` | Your Omnidesk subdomain |
| `OMNIDESK_EMAIL` | Omnidesk account email |
| `OMNIDESK_API_TOKEN` | Omnidesk API token |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OPENAI_API_KEY` | OpenAI API key (or `ANTHROPIC_API_KEY`) |

### 3. Setup Database

Run in Supabase SQL Editor:

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Run schema files
-- schema-v2.sql (tickets table)
-- schema-ai-agent.sql (AI logging)
```

See `schema-v2.sql` and `agent/README.md` for full SQL.

### 4. Ingest Tickets

```bash
npm run ingest              # Fetch all tickets
npm run ingest -- --dry-run # Preview only
```

### 5. Index FAQ

```bash
cd agent
python index_faq.py         # Index faq-data.json
python index_faq.py --clear # Clear and reindex
```

### 6. Run Agent

```bash
cd agent
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000 for the Web UI.

## Web UI

Modern Glass Morphism interface with:

- **Inbox Panel** — View latest tickets from Supabase
- **Quick Draft** — One-click draft generation
- **Auto-fill** — Click ticket to populate form
- **Copy to Clipboard** — Easy transfer to Omnidesk
- **Status Indicators** — Online/offline, confidence scores

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Web UI |
| GET | `/health` | Health check |
| GET | `/tickets/recent` | Get recent tickets |
| POST | `/generate` | Generate draft response |
| POST | `/classify` | Classify question only |
| POST | `/search` | Search FAQ directly |

### Example: Generate Draft

```bash
curl -X POST http://localhost:8000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_id": "123",
    "question": "Как создать заказ через API?",
    "client_name": "Test Client"
  }'
```

Response:
```json
{
  "ticket_id": "123",
  "draft_response": "Здравствуйте!...",
  "categories": ["api", "orders"],
  "needs_escalation": false,
  "confidence": 0.85,
  "retrieved_docs_count": 5
}
```

## Analytics & Reports

```bash
node analytics.js                    # Basic stats
node analytics-weekly-comparison.js  # Week-over-week
node analytics-by-client.js          # Per-client breakdown
node analytics-by-delivery.js        # Per-carrier stats
node report-monthly-deep.js          # Full monthly report
node report-last-week.js             # Last 7 days summary
```

## n8n Integration

Import workflows from:
- `n8n-final-workflow.json` — Production ingestion
- `n8n-ai-support-agent.json` — AI agent integration

See `n8n-setup-guide.md` for detailed configuration.

## Project Structure

```
├── agent/                  # Python AI Agent
│   ├── main.py            # FastAPI server
│   ├── agent.py           # LangChain agent
│   ├── vectorstore.py     # pgvector integration
│   ├── tools.py           # Agent tools
│   ├── prompts.py         # System prompts
│   ├── config.py          # Settings
│   └── static/index.html  # Web UI
├── ingest-tickets.js      # Omnidesk ingestion
├── analytics*.js          # Analytics scripts
├── report-*.js            # Report generators
├── faq-*.js               # FAQ tools
├── schema-*.sql           # Database schemas
├── n8n-*.json             # n8n workflows
└── CLAUDE.md              # Claude Code guidance
```

## Configuration

### LLM Provider

```bash
# OpenAI (default)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini

# Anthropic
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-5-sonnet-20241022
```

### RAG Settings

```bash
RETRIEVAL_K=5              # Documents to retrieve
SIMILARITY_THRESHOLD=0.7   # Minimum similarity
TEMPERATURE=0.3            # Generation temperature
```

## License

MIT
