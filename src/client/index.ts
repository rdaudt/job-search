import type { AppSummary, JobRecord, JobStatus, PersistedSearchProfile, RunRecord } from "../shared/types.js";

const importForm = document.querySelector<HTMLFormElement>("#import-form");
const searchFileInput = document.querySelector<HTMLInputElement>("#search-file");
const searchCount = document.querySelector<HTMLElement>("#search-count");
const searchList = document.querySelector<HTMLElement>("#search-list");
const runSearchesButton = document.querySelector<HTMLButtonElement>("#run-searches");
const runsContainer = document.querySelector<HTMLElement>("#runs");
const jobsBody = document.querySelector<HTMLElement>("#jobs-body");
const toast = document.querySelector<HTMLElement>("#toast");
const SUMMARY_REFRESH_INTERVAL_MS = 4000;

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

function renderRuns(runs: RunRecord[]): void {
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
      (run) => `
        <article class="run-card">
          <h3>Run #${run.id}</h3>
          <p class="run-meta">${new Date(run.startedAt).toLocaleString()}</p>
          <p class="run-meta">Opened ${run.searchCount} search URL${run.searchCount === 1 ? "" : "s"}</p>
        </article>
      `,
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

  if (!jobs.length) {
    jobsBody.innerHTML = `<tr><td colspan="6" class="empty-cell">No captured jobs yet.</td></tr>`;
    return;
  }

  jobsBody.innerHTML = jobs
    .map(
      (job) => `
        <tr>
          <td>
            <a class="job-link" href="${job.normalizedUrl}" target="_blank" rel="noreferrer">
              <span class="job-title">${job.title}</span>
            </a>
            ${job.summary ? `<p class="job-summary">${job.summary}</p>` : ""}
          </td>
          <td>${job.company || "Unknown"}</td>
          <td>${job.location || "Unknown"}</td>
          <td>${job.matchingSearchProfiles.join(", ")}</td>
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
    renderRuns(summary.runs);
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
  const response = await fetch("/api/runs", { method: "POST" });
  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    showToast(error.error ?? "Could not open searches.");
    return;
  }
  showToast("Opened search tabs.");
  await loadSummary();
});

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
