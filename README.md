# OpenFDA Public Explorer

A frontend-only public dashboard for recent FDA enforcement activity across drugs, devices, and foods. It calls openFDA no-key public APIs directly from the browser and is designed to be served from `/openfda`.

## Requirements

- No login or API key
- No backend/proxy
- No cookies, tracking, or user-data collection
- Footer text: `brought to you by Neuromancer`

## Local development

```bash
npm install
npm run dev
```

## Build and smoke check

```bash
npm run build
npm run check
```

The build uses Vite with `--base=/openfda/` so assets resolve correctly when deployed under the Case route `/openfda`.

## openFDA endpoints used

- `https://api.fda.gov/drug/enforcement.json`
- `https://api.fda.gov/device/enforcement.json`
- `https://api.fda.gov/food/enforcement.json`

The unauthenticated openFDA tier is intentionally used. Public limits documented by openFDA include 240 requests per minute per IP and 1,000 requests per day per IP, so the app uses small request limits and short-lived session cache.

## Case deployment

Target URL:

```text
http://ec2-3-143-250-160.us-east-2.compute.amazonaws.com/openfda
```

On the Case host, deploy with:

```bash
cd /opt/openfda
./scripts/deploy-case.sh
```

The script pulls `feature/openfda-public-explorer`, installs dependencies, builds for `/openfda`, copies `dist/` to `/var/www/openfda`, reloads Caddy, and verifies the local route and footer text.

## Public-data disclaimer

Data is retrieved from public openFDA/FDA datasets and may be incomplete, delayed, duplicated, or missing fields. This dashboard is informational only and is not medical, legal, or regulatory advice.
