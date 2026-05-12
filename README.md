# SEO Monitor

A lightweight local SEO monitoring dashboard for checking page health, core metadata, indexability signals, link counts, image alt coverage, load time, and score history.

## Features

- Add and remove monitored URLs
- Run a single check or check all sites
- SEO score based on status, title, description, H1, canonical, viewport, robots, load time, and image alt coverage
- Issue list with severity levels
- Per-site score history chart
- CSV export
- Redirect following for common 3xx responses
- No runtime npm dependencies

## Requirements

- Node.js 18 or newer

## Run Locally

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Deploy

### Render

This repository includes `render.yaml`. Create a new Render Blueprint from the GitHub repository, or create a Web Service with:

- Build command: empty
- Start command: `npm start`
- Environment variables:
  - `HOST=0.0.0.0`
  - `NODE_ENV=production`

### Docker

```bash
docker build -t seo-monitor .
docker run --rm -p 4173:4173 seo-monitor
```

## API

Check a URL:

```text
GET /api/check?url=https%3A%2F%2Fexample.com
```

The response includes the final URL, status code, load time, score, detected metadata, link and image counts, and issue list.

## Notes

This tool performs a lightweight HTML-level audit. It does not run Lighthouse, render JavaScript-heavy pages, query Google Search Console, or track rankings. Those integrations can be added later if needed.

## License

MIT
