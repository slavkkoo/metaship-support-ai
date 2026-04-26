# MetaShip Product Health Dashboard

Weekly product health dashboard for MetaShip support. Tracks ticket trends, top issues, client activity, and delivery service health.

## Architecture

```
Omnidesk API → ingest-tickets.js → Supabase → generate-dashboard-data.js → dashboard/
```

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Set OMNIDESK_*, SUPABASE_* variables

# Ingest tickets from Omnidesk
npm run ingest

# Generate dashboard data
node generate-dashboard-data.js

# View dashboard
open dashboard/index.html
# or
python3 -m http.server 8080 -d dashboard
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run ingest` | Fetch tickets from Omnidesk → Supabase |
| `node generate-dashboard-data.js` | Generate `dashboard/data.json` |
| `node extract-clients.js` | Extract client list from tickets |

## Environment Variables

```bash
OMNIDESK_SUBDOMAIN=your-subdomain
OMNIDESK_EMAIL=your-email
OMNIDESK_API_TOKEN=your-token
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
```

## Project Structure

```
├── dashboard/
│   ├── index.html          # Dashboard UI
│   └── data.json           # Generated data
├── ingest-tickets.js       # Omnidesk → Supabase
├── generate-dashboard-data.js  # Analytics → data.json
├── extract-clients.js      # Client extraction
├── .github/workflows/      # CI/CD (GitHub Pages)
└── package.json
```

## Deployment

Dashboard auto-deploys to GitHub Pages on push to `main`.

URL: https://slavkkoo.github.io/metaship-support-ai/

## License

MIT
