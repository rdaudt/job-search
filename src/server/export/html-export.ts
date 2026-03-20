import type { JobRecord } from "../../shared/types.js";
import { splitJobLocation } from "../../shared/location-utils.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTitleCell(job: JobRecord): string {
  const title = escapeHtml(job.title);
  if (job.isLinkable) {
    return `<a class="job-link" href="${escapeHtml(job.normalizedUrl)}" target="_blank" rel="noreferrer">${title}</a>`;
  }
  return title;
}

function getExportCity(job: JobRecord): string {
  return job.locationCity || splitJobLocation(job.location || "").city;
}

function getExportProvince(job: JobRecord): string {
  return job.locationProvince || splitJobLocation(job.location || "").province;
}

function renderRow(job: JobRecord, index: number): string {
  const city = getExportCity(job);
  const province = getExportProvince(job);
  const titleSort = escapeHtml(job.title.toLowerCase());
  const companySort = escapeHtml((job.company || "").toLowerCase());
  const citySort = escapeHtml(city.toLowerCase());
  const provinceSort = escapeHtml(province.toLowerCase());
  const relevanceSort = escapeHtml((job.effectiveRelevanceLabel || "").toLowerCase());
  const explanationSort = escapeHtml((job.effectiveRelevanceExplanation || "").toLowerCase());
  const searchesSort = escapeHtml(job.matchingSearchProfiles.join(", ").toLowerCase());
  const runLocationsSort = escapeHtml(job.matchingRunLocations.join(", ").toLowerCase());

  return `
    <tr
      data-title="${titleSort}"
      data-company="${companySort}"
      data-city="${citySort}"
      data-province="${provinceSort}"
      data-relevance="${relevanceSort}"
      data-explanation="${explanationSort}"
      data-searches="${searchesSort}"
      data-run-locations="${runLocationsSort}"
    >
      <td class="row-number">${index + 1}</td>
      <td>${renderTitleCell(job)}</td>
      <td>${escapeHtml(job.company || "Unknown")}</td>
      <td>${escapeHtml(city || "Unknown")}</td>
      <td>${escapeHtml(province || "Unknown")}</td>
      <td>${escapeHtml(job.effectiveRelevanceLabel === "relevant" ? "Relevant" : "Relevant")}</td>
      <td class="explanation-cell">${escapeHtml(job.effectiveRelevanceExplanation || "")}</td>
      <td>${escapeHtml(job.matchingSearchProfiles.join(", ") || "Unknown")}</td>
      <td>${escapeHtml(job.matchingRunLocations.join(", ") || "Any")}</td>
    </tr>
  `;
}

export function renderJobsHtmlExport(jobs: JobRecord[], generatedAt: string): string {
  const rows = jobs.map(renderRow).join("");
  const countLabel = `${jobs.length} relevant job${jobs.length === 1 ? "" : "s"}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Job Search Export</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: rgba(255, 252, 246, 0.96);
        --ink: #1f2a1f;
        --muted: #66705f;
        --border: rgba(31, 42, 31, 0.12);
        --accent: #2d6a4f;
        --accent-strong: #1b4332;
        --shadow: 0 22px 48px rgba(30, 34, 24, 0.08);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(244, 211, 94, 0.35), transparent 28%),
          linear-gradient(180deg, #faf7f2 0%, var(--bg) 100%);
        color: var(--ink);
      }

      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 40px 20px 72px;
      }

      .hero {
        margin-bottom: 20px;
      }

      .eyebrow {
        margin: 0 0 8px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 3vw, 3rem);
        line-height: 1;
        letter-spacing: -0.04em;
      }

      .lede {
        max-width: 820px;
        color: var(--muted);
        font-size: 1rem;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 24px;
        box-shadow: var(--shadow);
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        margin-bottom: 18px;
      }

      .panel-header h2 {
        margin: 0;
        font-size: 1.1rem;
      }

      .meta {
        color: var(--muted);
        font-size: 0.94rem;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        padding: 14px 10px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }

      th {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      .sort-button {
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: inherit;
        font-weight: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
        cursor: pointer;
      }

      .sort-button::after {
        content: "\\2195";
        margin-left: 6px;
        opacity: 0.4;
      }

      .sort-button.active::after {
        opacity: 1;
      }

      .sort-button[data-direction="asc"]::after {
        content: "\\2191";
      }

      .sort-button[data-direction="desc"]::after {
        content: "\\2193";
      }

      .row-number {
        width: 56px;
        text-align: right;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }

      .job-link {
        color: var(--accent-strong);
        font-weight: 700;
        text-decoration: none;
      }

      .job-link:hover {
        text-decoration: underline;
      }

      .explanation-cell {
        min-width: 320px;
        line-height: 1.55;
        color: var(--muted);
      }

      .empty-state {
        color: var(--muted);
        text-align: center;
        padding: 40px 0;
      }

      @media (max-width: 760px) {
        main {
          padding: 24px 14px 40px;
        }

        .panel {
          padding: 18px;
        }

        .panel-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .explanation-cell {
          min-width: 240px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Job search export</p>
        <h1>Relevant jobs snapshot</h1>
        <p class="lede">This self-contained HTML export includes only jobs currently marked as relevant. It can be opened locally and sorted in the browser without the original app.</p>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Relevant jobs</h2>
          <div class="meta">${escapeHtml(countLabel)} · Generated ${escapeHtml(new Date(generatedAt).toLocaleString())}</div>
        </div>
        <div class="table-wrap">
          ${
            jobs.length
              ? `<table>
            <thead>
              <tr>
                <th>#</th>
                <th><button class="sort-button" type="button" data-sort-field="title">Title</button></th>
                <th><button class="sort-button" type="button" data-sort-field="company">Company</button></th>
                <th><button class="sort-button" type="button" data-sort-field="city">City</button></th>
                <th><button class="sort-button" type="button" data-sort-field="province">Province</button></th>
                <th><button class="sort-button" type="button" data-sort-field="relevance">Relevance flag/status</button></th>
                <th><button class="sort-button" type="button" data-sort-field="explanation">Explanation</button></th>
                <th><button class="sort-button" type="button" data-sort-field="searches">Searches</button></th>
                <th><button class="sort-button" type="button" data-sort-field="run-locations">Run locations</button></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
              : `<div class="empty-state">No relevant jobs available for export.</div>`
          }
        </div>
      </section>
    </main>
    <script>
      (() => {
        const buttons = Array.from(document.querySelectorAll('.sort-button'));
        const tbody = document.querySelector('tbody');
        if (!tbody || buttons.length === 0) {
          return;
        }

        const renumberRows = () => {
          Array.from(tbody.querySelectorAll('tr')).forEach((row, index) => {
            const cell = row.querySelector('.row-number');
            if (cell) {
              cell.textContent = String(index + 1);
            }
          });
        };

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const field = button.dataset.sortField;
            if (!field) {
              return;
            }

            const nextDirection = button.dataset.direction === 'asc' ? 'desc' : 'asc';
            buttons.forEach((other) => {
              other.classList.remove('active');
              delete other.dataset.direction;
            });
            button.classList.add('active');
            button.dataset.direction = nextDirection;

            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort((left, right) => {
              const a = (left.dataset[field] || '').toLowerCase();
              const b = (right.dataset[field] || '').toLowerCase();
              return nextDirection === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
            });

            rows.forEach((row) => tbody.appendChild(row));
            renumberRows();
          });
        });
      })();
    </script>
  </body>
</html>`;
}
