# MetaShip Product Health Dashboard

Weekly dashboard: Omnidesk tickets → Supabase → analytics → static HTML.

## Commands

```bash
npm run ingest                  # Omnidesk → Supabase
node generate-dashboard-data.js # Generate dashboard/data.json
node extract-clients.js         # Extract clients
```

## Key Files

- `ingest-tickets.js` — Ticket ingestion (rate limiting, backoff on 429)
- `generate-dashboard-data.js` — Analytics: KPIs, trends, issues, clients, risks
- `extract-clients.js` — Client extraction from ticket text
- `dashboard/index.html` — Static dashboard UI (Chart.js)
- `dashboard/data.json` — Generated analytics data
