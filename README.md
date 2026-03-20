# Job Search Finder

Local TypeScript app and Chrome/Edge extension for running Indeed search profiles, capturing visible results, deduplicating them locally, and exporting CSV. The app never auto-applies and does not perform server-side scraping of Indeed pages.

Current scope: the app is restricted to Canadian locations and uses `ca.indeed.com` for searches.

## What It Does

- Imports search profiles from JSON or CSV.
- Opens one Indeed tab per run target on demand.
- Opens search tabs sequentially with configurable pacing and jitter between launches.
- Captures visible results from the active Indeed results page through a browser extension action.
- Follows the next results page in the same tab using either a fixed page cap or an auto-stop mode with guardrails and configurable next-page pacing.
- Lets each run choose whether previously captured jobs are kept cumulatively or deleted before the new run starts.
- Can optionally qualify captured jobs with OpenAI relevance scoring per search profile.
- Lets you add app-wide AI guidance, override relevance on individual jobs, and manually re-review jobs with that guidance.
- Stores jobs in local SQLite with deduplication and status tracking.
- Exports the current deduplicated job list as CSV.
- Exports a self-contained HTML snapshot of relevant jobs that can be opened locally.

## Search Profile Format

JSON example:

```json
[
  {
    "keywords": "frontend engineer react typescript",
    "location": "Vancouver, BC",
    "remote": true
  }
]
```

CSV columns:

```text
keywords,location,remote
frontend engineer react typescript,"Vancouver, BC",true
```

Only `keywords`, `location`, and `remote` are required from the user. If `id` or `name` are present in older files, the app still accepts them, but it now generates internal identifiers automatically when they are omitted.

`location` is a default location for that imported profile. It is optional, but if provided it must be a Canadian location. You can override it at run time from the app UI with one or more Canadian run locations.

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
7. Optionally enter one Canadian run location per line in the `Run locations` textarea.
8. Choose a run mode:
   - `Fixed pages`: stop after the selected page cap
   - `Auto until stop`: keep paginating until a stop rule fires
9. Choose a retention mode:
   - `Cumulative run`: keep existing jobs and update them if they appear again
   - `Reset previous jobs`: delete all previously captured jobs before starting this run
10. Set either:
   - `Pages per search` for fixed mode
   - `Auto stop after this many zero-new pages` for auto mode
11. Optionally tune pacing:
   - `Delay between launched searches` and `Launch jitter`
   - `Delay before next results page` and `Next-page jitter`
12. Click `Open Indeed Searches`.
13. If run locations are provided in the UI, each imported search profile will run against each entered location. If the textarea is blank, the app falls back to each profile's default `location`.
14. Indeed result tabs auto-capture after the page settles. In auto mode, the extension stops on no next page, repeated result URLs, verification/sign-in blocks, the zero-new threshold, or the hard 50-page emergency cap. Manual extension click remains available if needed.

## Optional OpenAI Relevance Qualification

If you set `OPENAI_API_KEY`, the app will asynchronously classify each captured job relative to each matching search profile and mark it as `Relevant`, `Borderline`, or `Irrelevant`.

Recommended setup: copy [.env.example](/d:/roque-projects/job-search/.env.example) to `.env` in the project root and fill in your key.

Example `.env`:

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=low
```

Notes:
- Raw jobs are captured first and stored immediately.
- Relevance classification runs in the background after capture.
- The Review Jobs table hides AI-irrelevant jobs by default, but you can show them with the toggle.
- The Review Jobs table shows the first 240 characters of each explanation by default and lets you expand longer explanations inline.
- The `Export App` action downloads a standalone HTML file containing only effectively relevant jobs.
- If `OPENAI_API_KEY` is not set, jobs remain `Unreviewed`.
- The app uses OpenAI's `responses` API. If `OPENAI_MODEL` is omitted, it now defaults to `gpt-5.4`.
- `OPENAI_REASONING_EFFORT` is optional and accepts `none`, `low`, `medium`, `high`, or `xhigh`. The default is `low`.
- The server loads `.env` automatically at startup, so `npm start` is enough once the file exists.
- You can save app-wide AI guidance, override relevance on a specific job with a note, and manually re-review all jobs without losing the raw captured data.

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
- The latest run card shows per-target progress including mode, pages captured, current status, and stop reason.
- Sequential launch pacing and next-page pacing are intended to reduce bursty automation patterns, but Indeed can still block pagination for some searches or sessions.
- Importing a different search file changes the active search profiles for the next run, but cumulative mode keeps previously captured jobs unless you explicitly choose `Reset previous jobs`.
- Relevance decisions are cached per job and search profile so repeated cumulative runs do not need to reclassify unchanged listings.
