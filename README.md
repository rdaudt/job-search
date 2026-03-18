# Job Search Finder

Local TypeScript app and Chrome/Edge extension for running Indeed search profiles, capturing visible results, deduplicating them locally, and exporting CSV. The app never auto-applies and does not perform server-side scraping of Indeed pages.

## What It Does

- Imports search profiles from JSON or CSV.
- Opens one Indeed tab per run target on demand.
- Captures visible results from the active Indeed results page through a browser extension action.
- Follows the next results page in the same tab up to a user-selected page limit.
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

`location` is now a default location for that imported profile. It is optional. You can override it at run time from the app UI with one or more run locations.

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
7. Optionally enter one run location per line in the `Run locations` textarea.
8. Choose a `Pages per search` limit.
9. Click `Open Indeed Searches`.
10. If run locations are provided in the UI, each imported search profile will run against each entered location. If the textarea is blank, the app falls back to each profile's default `location`.
11. Indeed result tabs auto-capture after the page settles. The extension can move to the next results page in the same tab until it reaches the page limit, hits the end of pagination, or stops on a capture failure. Manual extension click remains available if needed.

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
- Captures depend on Indeed's current search result DOM and may need selector updates if Indeed changes its page structure.
- Review jobs now preserve both the matching search profiles and the run locations that produced each job.
- The latest run card shows per-target progress including pages captured, current status, and stop reason.
