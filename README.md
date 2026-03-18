# Job Search Finder

Local TypeScript app and Chrome/Edge extension for running Indeed search profiles, capturing visible results, deduplicating them locally, and exporting CSV. The app never auto-applies and does not perform server-side scraping of Indeed pages.

## What It Does

- Imports search profiles from JSON or CSV.
- Opens one Indeed tab per search profile on demand.
- Captures visible results from the active Indeed results page through a browser extension action.
- Stores jobs in local SQLite with deduplication and status tracking.
- Exports the current deduplicated job list as CSV.

## Search Profile Format

JSON example:

```json
[
  {
    "id": "frontend-remote",
    "name": "Frontend Remote",
    "keywords": "frontend engineer react typescript",
    "location": "Vancouver, BC",
    "remote": true
  }
]
```

CSV columns:

```text
id,name,keywords,location,remote
frontend-remote,Frontend Remote,frontend engineer react typescript,"Vancouver, BC",true
```

## Run It

1. Install dependencies:

```bash
npm install
```

2. Build the app and extension:

```bash
npm run build
```

3. Start the local app:

```bash
npm start
```

4. Open `http://127.0.0.1:4312`.
5. Load the unpacked extension from `dist/extension` in Chrome or Edge developer mode.
6. Import your search profile file.
7. Click `Open Indeed Searches`.
8. On an Indeed results tab opened by the app, click the extension action to capture visible jobs.

## Playwright With The Extension

If you want an automated Chromium session with the unpacked extension loaded:

```bash
npm run playwright:extension
```

This launches a persistent Chromium profile with `dist/extension` loaded and opens `http://127.0.0.1:4312` by default.

You can also pass a different start URL:

```bash
npm run playwright:extension -- https://www.indeed.com/jobs?q=react
```

The script keeps the browser open until `Ctrl+C`. Make sure the app is already running if you want the local dashboard to load at startup.

## Files And Data

- SQLite database: `data/job-search.sqlite`
- Built app assets: `dist/`
- Example searches file: `dist/searches.example.json`

## Notes

- The remote flag currently augments the Indeed keyword query with `remote`. The search URL builder is isolated in the Indeed adapter so this can be refined later without changing storage or export logic.
- Captures depend on Indeed’s current search result DOM and may need selector updates if Indeed changes its page structure.
