import type { AppSummary, JobRecord, JobStatus, PersistedSearchProfile, RunRecord, RunTarget } from "../shared/types.js";

const importForm = document.querySelector<HTMLFormElement>("#import-form");
const searchFileInput = document.querySelector<HTMLInputElement>("#search-file");
const searchCount = document.querySelector<HTMLElement>("#search-count");
const searchList = document.querySelector<HTMLElement>("#search-list");
const runSearchesButton = document.querySelector<HTMLButtonElement>("#run-searches");
const retentionModeInput = document.querySelector<HTMLSelectElement>("#retention-mode");
const runModeInput = document.querySelector<HTMLSelectElement>("#run-mode");
const runModeHelper = document.querySelector<HTMLElement>("#run-mode-helper");
const maxPagesInput = document.querySelector<HTMLSelectElement>("#max-pages");
const zeroNewJobsThresholdInput = document.querySelector<HTMLSelectElement>("#zero-new-jobs-threshold");
const searchLaunchDelayInput = document.querySelector<HTMLSelectElement>("#search-launch-delay");
const searchLaunchJitterInput = document.querySelector<HTMLSelectElement>("#search-launch-jitter");
const pageDelayInput = document.querySelector<HTMLSelectElement>("#page-delay");
const pageDelayJitterInput = document.querySelector<HTMLSelectElement>("#page-delay-jitter");
const runLocationsInput = document.querySelector<HTMLTextAreaElement>("#run-locations");
const runLocationPreview = document.querySelector<HTMLElement>("#run-location-preview");
const runsContainer = document.querySelector<HTMLElement>("#runs");
const jobsBody = document.querySelector<HTMLElement>("#jobs-body");
const hideIrrelevantInput = document.querySelector<HTMLInputElement>("#hide-irrelevant");
const toast = document.querySelector<HTMLElement>("#toast");
const SUMMARY_REFRESH_INTERVAL_MS = 4000;
const RUN_LOCATIONS_STORAGE_KEY = "job-search-finder-run-locations";
const RETENTION_MODE_STORAGE_KEY = "job-search-finder-retention-mode";
const RUN_MODE_STORAGE_KEY = "job-search-finder-run-mode";
const MAX_PAGES_STORAGE_KEY = "job-search-finder-max-pages";
const ZERO_NEW_THRESHOLD_STORAGE_KEY = "job-search-finder-zero-new-threshold";
const SEARCH_LAUNCH_DELAY_STORAGE_KEY = "job-search-finder-search-launch-delay";
const SEARCH_LAUNCH_JITTER_STORAGE_KEY = "job-search-finder-search-launch-jitter";
const PAGE_DELAY_STORAGE_KEY = "job-search-finder-page-delay";
const PAGE_DELAY_JITTER_STORAGE_KEY = "job-search-finder-page-delay-jitter";
const HIDE_IRRELEVANT_STORAGE_KEY = "job-search-finder-hide-irrelevant";

let isLoadingSummary = false;
let previousJobCount = 0;
let hasLoadedSummary = false;

function showToast(message: string): void {
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), 2800);
}

function parseRunLocations(raw: string): string[] {
  const deduped = new Map<string, string>();
  raw
    .split(/\r?\n/)
    .map((entry) => entry.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .forEach((location) => {
      const key = location.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, location);
      }
    });
  return [...deduped.values()];
}

function renderRunLocationPreview(): string[] {
  const locations = parseRunLocations(runLocationsInput?.value ?? "");
  if (!runLocationPreview) {
    return locations;
  }

  runLocationPreview.textContent = locations.length
    ? `This run will open each imported search across ${locations.length} location${locations.length === 1 ? "" : "s"}: ${locations.join(", ")}`
    : "Leave blank to use each imported profile's default location.";
  return locations;
}

function renderSearches(searches: PersistedSearchProfile[]): void {
  if (!searchCount || !searchList) {
    return;
  }

  searchCount.textContent = `${searches.length} profile${searches.length === 1 ? "" : "s"}`;
  if (!searches.length) {
    searchList.innerHTML = "No search profiles loaded yet.";
    searchList.classList.add("empty-state");
    return;
  }

  searchList.classList.remove("empty-state");
  searchList.innerHTML = searches
    .map(
      (profile) => `
        <article class="search-card">
          <h3>${profile.name}</h3>
          <p class="search-meta"><strong>ID:</strong> ${profile.id}</p>
          <p class="search-meta"><strong>Keywords:</strong> ${profile.keywords}</p>
          <p class="search-meta"><strong>Location:</strong> ${profile.location || "Any"}</p>
          <p class="search-meta"><strong>Remote:</strong> ${profile.remote ? "Yes" : "No"}</p>
        </article>
      `,
    )
    .join("");
}

function humanizeStopReason(reason: string | null): string {
  if (!reason) {
    return "In progress";
  }

  const labels: Record<string, string> = {
    "indeed-verification-page": "Indeed verification blocked pagination",
    "indeed-signin-gate": "Indeed sign-in gate blocked pagination",
    "indeed-access-denied": "Indeed access denied"
  };

  return labels[reason] ?? reason.replace(/-/g, " ");
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function humanizeRelevance(job: JobRecord): string {
  if (job.relevanceStatus === "pending") {
    return "Pending AI review";
  }
  if (job.relevanceStatus === "failed") {
    return "AI failed";
  }
  if (job.relevanceStatus === "unreviewed") {
    return "Unreviewed";
  }
  if (job.relevanceLabel === "relevant") {
    return "Relevant";
  }
  if (job.relevanceLabel === "borderline") {
    return "Borderline";
  }
  if (job.relevanceLabel === "irrelevant") {
    return "Irrelevant";
  }
  return "Unreviewed";
}

function renderRunModeControls(): void {
  const mode = runModeInput?.value ?? "fixed";
  const isAuto = mode === "auto";

  maxPagesInput?.toggleAttribute("disabled", isAuto);
  zeroNewJobsThresholdInput?.toggleAttribute("disabled", !isAuto);
  if (runModeHelper) {
    runModeHelper.textContent = isAuto
      ? "Auto until stop follows pagination until no next page, repeated URLs, challenge detection, the zero-new-jobs threshold, or the 50-page emergency ceiling."
      : "Fixed pages stops after the selected number of result pages.";
  }
}

function renderRuns(runs: RunRecord[], latestRunTargets: RunTarget[]): void {
  if (!runsContainer) {
    return;
  }

  if (!runs.length) {
    runsContainer.innerHTML = "No runs yet.";
    runsContainer.classList.add("empty-state");
    return;
  }

  runsContainer.classList.remove("empty-state");
  runsContainer.innerHTML = runs
    .map(
      (run) => {
        const targetMarkup = latestRunTargets
          .filter((target) => target.runId === run.id)
          .map(
            (target) => `
              <li class="run-target-item">
                <strong>${target.searchProfileName}</strong>
                <span>${target.location || "Any"}</span>
                <span>${
                  target.runMode === "auto"
                    ? `${target.pagesCaptured}/${target.emergencyMaxPages} pages`
                    : `${target.pagesCaptured}/${target.maxPages} pages`
                }</span>
                <span>${target.status}</span>
                <span>${humanizeStopReason(target.stopReason)}</span>
              </li>
            `,
          )
          .join("");

        return `
        <article class="run-card">
          <h3>Run #${run.id}</h3>
          <p class="run-meta">${new Date(run.startedAt).toLocaleString()}</p>
          <p class="run-meta">
            Opened ${run.searchCount} search URL${run.searchCount === 1 ? "" : "s"} in ${run.runMode === "auto" ? "auto until stop" : "fixed pages"} mode
          </p>
          <p class="run-meta">
            ${run.retentionMode === "cumulative" ? "Cumulative run" : "Reset previous jobs"}
          </p>
          <p class="run-meta">
            ${
              run.runMode === "auto"
                ? `Stop after ${run.zeroNewJobsThreshold} consecutive zero-new pages, emergency cap ${run.emergencyMaxPages}`
                : `Page limit ${run.maxPages}`
            }
          </p>
          <p class="run-meta">
            Launch pacing ${formatSeconds(run.searchLaunchDelayMs)} + up to ${formatSeconds(run.searchLaunchJitterMs)} jitter,
            next-page pacing ${formatSeconds(run.pageDelayMs)} + up to ${formatSeconds(run.pageDelayJitterMs)} jitter
          </p>
          ${
            targetMarkup
              ? `<ul class="run-target-list">${targetMarkup}</ul>`
              : ""
          }
        </article>
      `;
      },
    )
    .join("");
}

function statusOptions(selected: JobStatus): string {
  return ["new", "reviewed", "saved", "ignored"]
    .map((status) => `<option value="${status}" ${selected === status ? "selected" : ""}>${status}</option>`)
    .join("");
}

function renderJobs(jobs: JobRecord[]): void {
  if (!jobsBody) {
    return;
  }

  const hideIrrelevant = hideIrrelevantInput?.checked ?? true;
  const visibleJobs = hideIrrelevant
    ? jobs.filter((job) => !(job.relevanceStatus === "complete" && job.relevanceLabel === "irrelevant"))
    : jobs;

  if (!visibleJobs.length) {
    jobsBody.innerHTML = `<tr><td colspan="8" class="empty-cell">No captured jobs yet.</td></tr>`;
    return;
  }

  jobsBody.innerHTML = visibleJobs
    .map(
      (job) => `
        <tr>
          <td>
            ${
              job.isLinkable
                ? `<a class="job-link" href="${job.normalizedUrl}" target="_blank" rel="noreferrer">
              <span class="job-title">${job.title}</span>
            </a>`
                : `<span class="job-title">${job.title}</span>`
            }
            ${job.summary ? `<p class="job-summary">${job.summary}</p>` : ""}
          </td>
          <td>${job.company || "Unknown"}</td>
          <td>${job.location || "Unknown"}</td>
          <td>
            <span class="job-relevance">${humanizeRelevance(job)}</span>
            ${job.relevanceReason ? `<p class="job-summary">${job.relevanceReason}</p>` : ""}
          </td>
          <td>${job.matchingSearchProfiles.join(", ")}</td>
          <td>${job.matchingRunLocations.join(", ") || "Any"}</td>
          <td>${new Date(job.lastSeenAt).toLocaleString()}</td>
          <td>
            <select class="status-select" data-job-id="${job.id}">
              ${statusOptions(job.status)}
            </select>
          </td>
        </tr>
      `,
    )
    .join("");
}

function bindStatusEditors(): void {
  document.querySelectorAll<HTMLSelectElement>(".status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const jobId = Number(select.dataset.jobId);
      const response = await fetch(`/api/jobs/${jobId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: select.value })
      });

      if (!response.ok) {
        showToast("Could not update job status.");
        return;
      }

      showToast(`Status updated to ${select.value}.`);
    });
  });
}

async function loadSummary(): Promise<void> {
  if (isLoadingSummary) {
    return;
  }

  isLoadingSummary = true;
  try {
    const response = await fetch("/api/summary");
    const summary = (await response.json()) as AppSummary;
    renderSearches(summary.searches);
    renderRuns(summary.runs, summary.latestRunTargets);
    renderJobs(summary.jobs);
    bindStatusEditors();

    if (hasLoadedSummary && summary.jobs.length > previousJobCount) {
      const captured = summary.jobs.length - previousJobCount;
      showToast(`Captured ${captured} new job${captured === 1 ? "" : "s"}.`);
    }

    previousJobCount = summary.jobs.length;
    hasLoadedSummary = true;
  } finally {
    isLoadingSummary = false;
  }
}

importForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = searchFileInput?.files?.[0];
  if (!file) {
    showToast("Select a JSON or CSV file first.");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/searches/import", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    showToast(error.error ?? "Import failed.");
    return;
  }

  showToast("Search profiles imported.");
  if (searchFileInput) {
    searchFileInput.value = "";
  }
  await loadSummary();
});

runSearchesButton?.addEventListener("click", async () => {
  const locations = renderRunLocationPreview();
  const retentionMode = retentionModeInput?.value === "reset" ? "reset" : "cumulative";
  const mode = runModeInput?.value === "auto" ? "auto" : "fixed";
  const maxPages = Math.max(1, Number(maxPagesInput?.value ?? "1") || 1);
  const zeroNewJobsThreshold = Math.max(1, Number(zeroNewJobsThresholdInput?.value ?? "2") || 2);
  const searchLaunchDelayMs = Math.max(0, Number(searchLaunchDelayInput?.value ?? "20000") || 0);
  const searchLaunchJitterMs = Math.max(0, Number(searchLaunchJitterInput?.value ?? "20000") || 0);
  const pageDelayMs = Math.max(0, Number(pageDelayInput?.value ?? "8000") || 0);
  const pageDelayJitterMs = Math.max(0, Number(pageDelayJitterInput?.value ?? "12000") || 0);
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      locations,
      retentionMode,
      mode,
      maxPages,
      zeroNewJobsThreshold,
      searchLaunchDelayMs,
      searchLaunchJitterMs,
      pageDelayMs,
      pageDelayJitterMs
    })
  });
  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    showToast(error.error ?? "Could not open searches.");
    return;
  }
  showToast("Queued search tabs.");
  await loadSummary();
});

hideIrrelevantInput?.addEventListener("change", () => {
  localStorage.setItem(HIDE_IRRELEVANT_STORAGE_KEY, hideIrrelevantInput.checked ? "true" : "false");
  void loadSummary();
});

retentionModeInput?.addEventListener("change", () => {
  localStorage.setItem(RETENTION_MODE_STORAGE_KEY, retentionModeInput.value);
});

runLocationsInput?.addEventListener("input", () => {
  localStorage.setItem(RUN_LOCATIONS_STORAGE_KEY, runLocationsInput.value);
  renderRunLocationPreview();
});

runModeInput?.addEventListener("change", () => {
  localStorage.setItem(RUN_MODE_STORAGE_KEY, runModeInput.value);
  renderRunModeControls();
});

maxPagesInput?.addEventListener("change", () => {
  localStorage.setItem(MAX_PAGES_STORAGE_KEY, maxPagesInput.value);
});

zeroNewJobsThresholdInput?.addEventListener("change", () => {
  localStorage.setItem(ZERO_NEW_THRESHOLD_STORAGE_KEY, zeroNewJobsThresholdInput.value);
});

searchLaunchDelayInput?.addEventListener("change", () => {
  localStorage.setItem(SEARCH_LAUNCH_DELAY_STORAGE_KEY, searchLaunchDelayInput.value);
});

searchLaunchJitterInput?.addEventListener("change", () => {
  localStorage.setItem(SEARCH_LAUNCH_JITTER_STORAGE_KEY, searchLaunchJitterInput.value);
});

pageDelayInput?.addEventListener("change", () => {
  localStorage.setItem(PAGE_DELAY_STORAGE_KEY, pageDelayInput.value);
});

pageDelayJitterInput?.addEventListener("change", () => {
  localStorage.setItem(PAGE_DELAY_JITTER_STORAGE_KEY, pageDelayJitterInput.value);
});

if (runLocationsInput) {
  runLocationsInput.value = localStorage.getItem(RUN_LOCATIONS_STORAGE_KEY) ?? "";
  renderRunLocationPreview();
}

if (maxPagesInput) {
  maxPagesInput.value = localStorage.getItem(MAX_PAGES_STORAGE_KEY) ?? "3";
}

if (runModeInput) {
  runModeInput.value = localStorage.getItem(RUN_MODE_STORAGE_KEY) ?? "fixed";
}

if (retentionModeInput) {
  retentionModeInput.value = localStorage.getItem(RETENTION_MODE_STORAGE_KEY) ?? "cumulative";
}

if (zeroNewJobsThresholdInput) {
  zeroNewJobsThresholdInput.value = localStorage.getItem(ZERO_NEW_THRESHOLD_STORAGE_KEY) ?? "2";
}

if (searchLaunchDelayInput) {
  searchLaunchDelayInput.value = localStorage.getItem(SEARCH_LAUNCH_DELAY_STORAGE_KEY) ?? "20000";
}

if (searchLaunchJitterInput) {
  searchLaunchJitterInput.value = localStorage.getItem(SEARCH_LAUNCH_JITTER_STORAGE_KEY) ?? "20000";
}

if (pageDelayInput) {
  pageDelayInput.value = localStorage.getItem(PAGE_DELAY_STORAGE_KEY) ?? "8000";
}

if (pageDelayJitterInput) {
  pageDelayJitterInput.value = localStorage.getItem(PAGE_DELAY_JITTER_STORAGE_KEY) ?? "12000";
}

if (hideIrrelevantInput) {
  hideIrrelevantInput.checked = (localStorage.getItem(HIDE_IRRELEVANT_STORAGE_KEY) ?? "true") !== "false";
}

renderRunModeControls();

void loadSummary();
window.setInterval(() => {
  void loadSummary();
}, SUMMARY_REFRESH_INTERVAL_MS);

window.addEventListener("focus", () => {
  void loadSummary();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void loadSummary();
  }
});
