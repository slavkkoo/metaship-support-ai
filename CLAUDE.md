# MetaShip Product Health Dashboard

Weekly dashboard: Omnidesk tickets → Supabase → analytics → GitHub Pages.

## Weekly Update (every Monday)

```bash
npm run update
```

This command:
1. Fetches new tickets from Omnidesk → Supabase
2. Generates fresh `dashboard/data.json`
3. Commits and pushes → triggers GitHub Pages deploy

## Commands

```bash
npm run update    # Full weekly update (ingest + generate + push)
npm run ingest    # Only fetch tickets from Omnidesk
npm run generate  # Only generate data.json
npm run dashboard # Local preview at http://localhost:8080
```

## Key Files

- `ingest-tickets.js` — Ticket ingestion (rate limiting, backoff on 429)
- `generate-dashboard-data.js` — Analytics: KPIs, trends, issues, clients, risks
- `extract-clients.js` — Client extraction from ticket text
- `dashboard/index.html` — Static dashboard UI (Chart.js)
- `dashboard/data.json` — Generated analytics data

## Dashboard URL

https://slavkkoo.github.io/metaship-support-ai/
