import type { AiReviewSummary, AppSummary, JobRecord, JobStatus, PersistedSearchProfile, RunRecord, RunTarget } from "../shared/types.js";
import {
  getDefaultSortDirection,
  getRelevanceExplanation,
  getRelevanceFlagStatus,
  jobSortFields,
  matchesRelevanceFilter,
  relevanceFilterValues,
  sortJobs,
  type JobSortField,
  type RelevanceFilterValue,
  type SortDirection
} from "./job-table.js";

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
const guidanceInput = document.querySelector<HTMLTextAreaElement>("#relevance-guidance");
const saveGuidanceButton = document.querySelector<HTMLButtonElement>("#save-guidance");
const rereviewJobsButton = document.querySelector<HTMLButtonElement>("#rereview-jobs");
const aiReviewCard = document.querySelector<HTMLElement>("#ai-review-card");
const aiReviewState = document.querySelector<HTMLElement>("#ai-review-state");
const aiReviewProgress = document.querySelector<HTMLElement>("#ai-review-progress");
const aiReviewBarFill = document.querySelector<HTMLElement>("#ai-review-bar-fill");
const aiReviewCounts = document.querySelector<HTMLElement>("#ai-review-counts");
const aiReviewUpdated = document.querySelector<HTMLElement>("#ai-review-updated");
const jobsBody = document.querySelector<HTMLElement>("#jobs-body");
const relevanceFilterInput = document.querySelector<HTMLSelectElement>("#relevance-filter");
const toast = document.querySelector<HTMLElement>("#toast");
const sortButtons = document.querySelectorAll<HTMLButtonElement>(".sort-button");
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
const RELEVANCE_FILTER_STORAGE_KEY = "job-search-finder-relevance-filter";
const JOB_SORT_FIELD_STORAGE_KEY = "job-search-finder-job-sort-field";
const JOB_SORT_DIRECTION_STORAGE_KEY = "job-search-finder-job-sort-direction";

let isLoadingSummary = false;
let pendingSummaryReload = false;
let previousJobCount = 0;
let hasLoadedSummary = false;
let currentRelevanceFilter: RelevanceFilterValue = "all";
let currentSortField: JobSortField = "relevance";
let currentSortDirection: SortDirection = "asc";
let guidanceDraft: string | null = null;
const overrideDrafts = new Map<number, { relevance: string; note: string }>();
let previousAiPendingCount = 0;

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

function renderGuidance(guidance: string): void {
  if (guidanceInput) {
    guidanceInput.value = guidanceDraft ?? guidance;
  }
}

function renderAiReviewStatus(summary: AiReviewSummary): void {
  if (!aiReviewCard || !aiReviewState || !aiReviewProgress || !aiReviewBarFill || !aiReviewCounts || !aiReviewUpdated) {
    return;
  }

  aiReviewCard.classList.remove("ai-review-idle", "ai-review-active", "ai-review-complete", "ai-review-warning");

  const total = summary.totalCount;
  const percent = total > 0 ? Math.round((summary.completeCount / total) * 100) : 0;
  aiReviewBarFill.style.width = `${percent}%`;
  aiReviewCounts.textContent = `${summary.pendingCount} pending, ${summary.completeCount} complete, ${summary.failedCount} failed`;
  aiReviewUpdated.textContent = summary.lastUpdatedAt
    ? `Last updated: ${new Date(summary.lastUpdatedAt).toLocaleString()}`
    : "Last updated: never";

  switch (summary.status) {
    case "in_progress":
      aiReviewCard.classList.add("ai-review-active");
      aiReviewState.textContent = "Reviewing jobs";
      aiReviewProgress.textContent = `${summary.completeCount} of ${summary.totalCount} assessments complete`;
      break;
    case "completed":
      aiReviewCard.classList.add("ai-review-complete");
      aiReviewState.textContent = "Completed";
      aiReviewProgress.textContent = `AI review complete for ${summary.totalCount} assessments`;
      aiReviewBarFill.style.width = total > 0 ? "100%" : "0";
      break;
    case "completed_with_failures":
      aiReviewCard.classList.add("ai-review-warning");
      aiReviewState.textContent = "Completed with failures";
      aiReviewProgress.textContent = `${summary.completeCount} of ${summary.totalCount} assessments complete`;
      break;
    default:
      aiReviewCard.classList.add("ai-review-idle");
      aiReviewState.textContent = "Idle";
      aiReviewProgress.textContent = "No AI review queued yet.";
      aiReviewBarFill.style.width = "0";
      break;
  }
}

function renderSortIndicators(): void {
  sortButtons.forEach((button) => {
    const field = button.dataset.sortField as JobSortField | undefined;
    const isActive = field === currentSortField;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.dataset.sortDirection = currentSortDirection;
    } else {
      delete button.dataset.sortDirection;
    }
  });
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

  const visibleJobs = sortJobs(
    jobs.filter((job) => matchesRelevanceFilter(job, currentRelevanceFilter)),
    currentSortField,
    currentSortDirection
  );

  if (!visibleJobs.length) {
    jobsBody.innerHTML = `<tr><td colspan="10" class="empty-cell">No jobs match the current filter.</td></tr>`;
    return;
  }

  jobsBody.innerHTML = visibleJobs
    .map(
      (job) => {
        const draft = overrideDrafts.get(job.id);
        const overrideValue = draft?.relevance ?? job.userOverrideLabel ?? "";
        const overrideNote = draft?.note ?? job.userOverrideNote ?? "";

        return `
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
          <td><span class="job-relevance ${job.hasUserOverride ? "user-override" : ""}">${getRelevanceFlagStatus(job)}</span></td>
          <td>
            <span class="job-summary">${getRelevanceExplanation(job)}</span>
          </td>
          <td>${job.matchingSearchProfiles.join(", ") || "Unknown"}</td>
          <td>${job.matchingRunLocations.join(", ") || "Any"}</td>
          <td>${new Date(job.lastSeenAt).toLocaleString()}</td>
          <td>
            <select class="status-select" data-job-id="${job.id}">
              ${statusOptions(job.status)}
            </select>
          </td>
          <td>
            <div class="override-controls">
              <select class="override-select" data-job-id="${job.id}">
                <option value="">No override</option>
                <option value="relevant" ${overrideValue === "relevant" ? "selected" : ""}>Relevant</option>
                <option value="borderline" ${overrideValue === "borderline" ? "selected" : ""}>Borderline</option>
                <option value="irrelevant" ${overrideValue === "irrelevant" ? "selected" : ""}>Irrelevant</option>
              </select>
              <textarea class="override-note" data-job-id="${job.id}" rows="3" placeholder="Explain why this job should be treated differently.">${overrideNote}</textarea>
              <div class="override-actions">
                <button class="save-override-button" type="button" data-job-id="${job.id}">Save</button>
                <button class="clear-override-button" type="button" data-job-id="${job.id}" ${job.hasUserOverride || Boolean(draft?.relevance || draft?.note) ? "" : "disabled"}>Clear</button>
              </div>
            </div>
          </td>
        </tr>
      `;
      },
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

function bindOverrideEditors(): void {
  document.querySelectorAll<HTMLSelectElement>(".override-select").forEach((select) => {
    select.addEventListener("change", () => {
      const jobId = Number(select.dataset.jobId);
      const current = overrideDrafts.get(jobId) ?? {
        relevance: "",
        note: document.querySelector<HTMLTextAreaElement>(`.override-note[data-job-id="${jobId}"]`)?.value ?? ""
      };
      overrideDrafts.set(jobId, {
        ...current,
        relevance: select.value
      });
    });
  });

  document.querySelectorAll<HTMLTextAreaElement>(".override-note").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const jobId = Number(textarea.dataset.jobId);
      const current = overrideDrafts.get(jobId) ?? {
        relevance: document.querySelector<HTMLSelectElement>(`.override-select[data-job-id="${jobId}"]`)?.value ?? "",
        note: ""
      };
      overrideDrafts.set(jobId, {
        ...current,
        note: textarea.value
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".save-override-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = Number(button.dataset.jobId);
      const select = document.querySelector<HTMLSelectElement>(`.override-select[data-job-id="${jobId}"]`);
      const note = document.querySelector<HTMLTextAreaElement>(`.override-note[data-job-id="${jobId}"]`);
      const relevance = select?.value ?? "";
      const message = note?.value.trim() ?? "";

      if (!relevance) {
        showToast("Choose a relevance override before saving.");
        return;
      }
      if (!message) {
        showToast("Add a note explaining the override.");
        return;
      }

      const response = await fetch(`/api/jobs/${jobId}/relevance-override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relevance, note: message })
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: "Could not save override." }))) as { error?: string };
        showToast(error.error ?? "Could not save override.");
        return;
      }

      overrideDrafts.delete(jobId);
      showToast("Relevance override saved.");
      await loadSummary();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".clear-override-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = Number(button.dataset.jobId);
      const response = await fetch(`/api/jobs/${jobId}/relevance-override`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: "Could not clear override." }))) as { error?: string };
        showToast(error.error ?? "Could not clear override.");
        return;
      }

      overrideDrafts.delete(jobId);
      showToast("Relevance override cleared.");
      await loadSummary();
    });
  });
}

async function loadSummary(): Promise<void> {
  if (isLoadingSummary) {
    pendingSummaryReload = true;
    return;
  }

  isLoadingSummary = true;
  try {
    const response = await fetch("/api/summary");
    const summary = (await response.json()) as AppSummary;
    renderGuidance(summary.settings.relevanceGuidance);
    renderAiReviewStatus(summary.aiReview);
    renderSearches(summary.searches);
    renderRuns(summary.runs, summary.latestRunTargets);
    renderJobs(summary.jobs);
    renderSortIndicators();
    bindStatusEditors();
    bindOverrideEditors();

    if (hasLoadedSummary && summary.jobs.length > previousJobCount) {
      const captured = summary.jobs.length - previousJobCount;
      showToast(`Captured ${captured} new job${captured === 1 ? "" : "s"}.`);
    }

    if (hasLoadedSummary && previousAiPendingCount > 0 && summary.aiReview.pendingCount === 0) {
      showToast(
        summary.aiReview.failedCount > 0
          ? "AI review completed with failures."
          : "AI review completed."
      );
    }

    previousJobCount = summary.jobs.length;
    previousAiPendingCount = summary.aiReview.pendingCount;
    hasLoadedSummary = true;
  } finally {
    isLoadingSummary = false;
    if (pendingSummaryReload) {
      pendingSummaryReload = false;
      void loadSummary();
    }
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

saveGuidanceButton?.addEventListener("click", async () => {
  const guidance = guidanceInput?.value ?? "";
  const response = await fetch("/api/settings/relevance-guidance", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ guidance })
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Could not save guidance." }))) as { error?: string };
    showToast(error.error ?? "Could not save guidance.");
    return;
  }

  guidanceDraft = null;
  showToast("AI guidance saved.");
  await loadSummary();
});

rereviewJobsButton?.addEventListener("click", async () => {
  const response = await fetch("/api/relevance/rereview", { method: "POST" });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Could not queue re-review." }))) as { error?: string };
    showToast(error.error ?? "Could not queue re-review.");
    return;
  }

  showToast("Queued AI re-review for all jobs.");
  await loadSummary();
});

relevanceFilterInput?.addEventListener("change", () => {
  const nextFilter = relevanceFilterValues.includes((relevanceFilterInput.value as RelevanceFilterValue))
    ? (relevanceFilterInput.value as RelevanceFilterValue)
    : "all";
  currentRelevanceFilter = nextFilter;
  localStorage.setItem(RELEVANCE_FILTER_STORAGE_KEY, nextFilter);
  void loadSummary();
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const field = button.dataset.sortField as JobSortField | undefined;
    if (!field || !jobSortFields.includes(field)) {
      return;
    }

    if (field === currentSortField) {
      currentSortDirection = currentSortDirection === "asc" ? "desc" : "asc";
    } else {
      currentSortField = field;
      currentSortDirection = getDefaultSortDirection(field);
    }

    localStorage.setItem(JOB_SORT_FIELD_STORAGE_KEY, currentSortField);
    localStorage.setItem(JOB_SORT_DIRECTION_STORAGE_KEY, currentSortDirection);
    void loadSummary();
  });
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

guidanceInput?.addEventListener("input", () => {
  guidanceDraft = guidanceInput.value;
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

if (relevanceFilterInput) {
  const storedFilter = localStorage.getItem(RELEVANCE_FILTER_STORAGE_KEY);
  currentRelevanceFilter =
    storedFilter && relevanceFilterValues.includes(storedFilter as RelevanceFilterValue)
      ? (storedFilter as RelevanceFilterValue)
      : "all";
  relevanceFilterInput.value = currentRelevanceFilter;
}

{
  const storedSortField = localStorage.getItem(JOB_SORT_FIELD_STORAGE_KEY);
  currentSortField =
    storedSortField && jobSortFields.includes(storedSortField as JobSortField)
      ? (storedSortField as JobSortField)
      : "relevance";
  const storedSortDirection = localStorage.getItem(JOB_SORT_DIRECTION_STORAGE_KEY);
  currentSortDirection =
    storedSortDirection === "asc" || storedSortDirection === "desc"
      ? storedSortDirection
      : getDefaultSortDirection(currentSortField);
}

renderRunModeControls();
renderSortIndicators();

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
