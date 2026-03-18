import { attachRunTargetMetadata } from "../shared/indeed.js";
import type { CapturePayload, RunTarget, RunTargetStateUpdate } from "../shared/types.js";
import { resolveRunTargetIdFromUrl } from "./profile-matching.js";

const API_URL = "http://127.0.0.1:4312/api/captures";
const SUMMARY_URL = "http://127.0.0.1:4312/api/summary";
const AUTO_CAPTURE_DELAYS_MS = [1500, 4500, 9000];
const autoCaptureStateByTabId = new Map<number, AutoCaptureState>();

type AppSummary = {
  latestRunTargets: RunTarget[];
};

type AutoCaptureState = {
  currentUrl: string;
  attemptIndex: number;
  success: boolean;
  visitedPageUrls: string[];
  runTargetId: string | null;
  maxPages: number | null;
};

type CapturePageContext = {
  runTargetId: string | null;
  pageUrl: string;
  pageNumber: number;
  nextPageUrl: string | null;
};

type ContentCaptureResponse =
  | {
      payload: Omit<CapturePayload, "runTargetId"> & {
        runTargetId: string | null;
        nextPageUrl: string | null;
      };
      error?: never;
      pageContext?: never;
    }
  | {
      error: string;
      pageContext: CapturePageContext;
      payload?: never;
    };

type CaptureTabResult = {
  inserted: number;
  updated: number;
  runTarget: RunTarget;
  pageNumber: number;
  pageUrl: string;
  nextPageUrl: string | null;
};

type CaptureFailure = Error & {
  pageContext?: CapturePageContext;
  runTarget?: RunTarget;
};

async function fetchLatestRunTargets(): Promise<RunTarget[]> {
  const response = await fetch(SUMMARY_URL);
  if (!response.ok) {
    throw new Error(`Could not load run targets from local app: ${response.status}`);
  }

  const summary = (await response.json()) as AppSummary;
  return summary.latestRunTargets;
}

function normalizePageUrl(pageUrl: string): string {
  const parsed = new URL(pageUrl);
  parsed.hash = "";
  parsed.searchParams.delete("jobFinderProfile");
  parsed.searchParams.delete("jobFinderRunTarget");
  return parsed.toString();
}

async function resolveRunTarget(pageContext: CapturePageContext): Promise<RunTarget | null> {
  const runTargets = await fetchLatestRunTargets();
  if (pageContext.runTargetId) {
    const directMatch = runTargets.find((runTarget) => runTarget.id === pageContext.runTargetId);
    if (directMatch) {
      return directMatch;
    }
  }

  const inferredId = resolveRunTargetIdFromUrl(pageContext.pageUrl, runTargets);
  return inferredId ? runTargets.find((runTarget) => runTarget.id === inferredId) ?? null : null;
}

async function reportRunTargetState(runTargetId: string, update: RunTargetStateUpdate): Promise<void> {
  const response = await fetch(`http://127.0.0.1:4312/api/run-targets/${encodeURIComponent(runTargetId)}/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(update)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to update run target state.");
  }
}

async function captureTab(tabId: number): Promise<CaptureTabResult> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: "capture-visible-jobs"
  })) as ContentCaptureResponse | undefined;
  const pageContext = response?.payload
    ? {
        runTargetId: response.payload.runTargetId ?? null,
        pageUrl: response.payload.pageUrl,
        pageNumber: response.payload.pageNumber,
        nextPageUrl: response.payload.nextPageUrl ?? null
      }
    : response?.pageContext;

  const runTarget = pageContext ? await resolveRunTarget(pageContext) : null;
  if (response?.error) {
    const error = new Error(response.error) as CaptureFailure;
    error.pageContext = pageContext;
    if (runTarget) {
      error.runTarget = runTarget;
    }
    throw error;
  }

  if (!response?.payload || !pageContext || !runTarget) {
    throw new Error("Could not match this Indeed tab to a launched run target.");
  }

  const postResponse = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...response.payload,
      runTargetId: runTarget.id
    })
  });

  if (!postResponse.ok) {
    const errorText = await postResponse.text();
    const error = new Error(errorText || "Failed to send capture payload.") as CaptureFailure;
    error.pageContext = pageContext;
    error.runTarget = runTarget;
    throw error;
  }

  const result = (await postResponse.json()) as { inserted: number; updated: number };
  const badgeText = `${result.inserted + result.updated}`;
  chrome.action.setBadgeBackgroundColor({ color: "#1b4332", tabId });
  chrome.action.setBadgeText({ tabId, text: badgeText });

  return {
    ...result,
    runTarget,
    pageNumber: pageContext.pageNumber,
    pageUrl: pageContext.pageUrl,
    nextPageUrl: pageContext.nextPageUrl ? attachRunTargetMetadata(pageContext.nextPageUrl, runTarget) : null
  };
}

function isIndeedSearchResultsPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("indeed.com") && parsed.pathname.startsWith("/jobs");
  } catch {
    return false;
  }
}

async function finalizeRunTarget(
  runTarget: RunTarget,
  status: RunTargetStateUpdate["status"],
  stopReason: string,
  pageNumber: number | undefined,
  pageUrl: string | undefined,
): Promise<void> {
  await reportRunTargetState(runTarget.id, {
    status,
    stopReason,
    pageNumber,
    pageUrl
  });
}

async function continuePagination(tabId: number, result: CaptureTabResult): Promise<void> {
  const currentState = autoCaptureStateByTabId.get(tabId);
  const visitedPageUrls = new Set(currentState?.visitedPageUrls ?? []);
  visitedPageUrls.add(normalizePageUrl(result.pageUrl));

  autoCaptureStateByTabId.set(tabId, {
    currentUrl: result.pageUrl,
    attemptIndex: 0,
    success: true,
    visitedPageUrls: [...visitedPageUrls],
    runTargetId: result.runTarget.id,
    maxPages: result.runTarget.maxPages
  });

  let stopReason: string | null = null;
  if (result.pageNumber >= result.runTarget.maxPages) {
    stopReason = "page-limit-reached";
  } else if (!result.nextPageUrl) {
    stopReason = "no-next-page";
  } else if (visitedPageUrls.has(normalizePageUrl(result.nextPageUrl))) {
    stopReason = "repeated-page-url";
  }

  if (stopReason) {
    await finalizeRunTarget(result.runTarget, "completed", stopReason, result.pageNumber, result.pageUrl);
    return;
  }

  await chrome.tabs.update(tabId, { url: result.nextPageUrl });
}

async function handleCaptureFailure(tabId: number, error: unknown): Promise<void> {
  const typedError = error instanceof Error ? (error as CaptureFailure) : new Error(String(error));
  console.error("Capture failed", typedError);
  chrome.action.setBadgeBackgroundColor({ color: "#9d0208", tabId });
  chrome.action.setBadgeText({ tabId, text: "!" });

  if (typedError.runTarget) {
    const stopReason = typedError.message.includes("No visible job cards")
      ? "no-job-cards-detected"
      : "capture-failed";
    await finalizeRunTarget(
      typedError.runTarget,
      "failed",
      stopReason,
      typedError.pageContext?.pageNumber,
      typedError.pageContext?.pageUrl,
    ).catch((stateError) => {
      console.error("Failed to report run target failure", stateError);
    });
  }
}

function scheduleAutoCapture(tabId: number, url: string, attemptIndex: number): void {
  const delay = AUTO_CAPTURE_DELAYS_MS[attemptIndex];
  if (delay === undefined) {
    return;
  }

  globalThis.setTimeout(() => {
    const currentState = autoCaptureStateByTabId.get(tabId);
    if (!currentState || currentState.currentUrl !== url || currentState.success || currentState.attemptIndex !== attemptIndex) {
      return;
    }

    void captureTab(tabId)
      .then((result) => continuePagination(tabId, result))
      .catch((error) => {
        const nextAttemptIndex = attemptIndex + 1;
        if (AUTO_CAPTURE_DELAYS_MS[nextAttemptIndex] !== undefined) {
          autoCaptureStateByTabId.set(tabId, {
            ...(currentState ?? {
              currentUrl: url,
              visitedPageUrls: [],
              runTargetId: null,
              maxPages: null
            }),
            currentUrl: url,
            attemptIndex: nextAttemptIndex,
            success: false
          });
          scheduleAutoCapture(tabId, url, nextAttemptIndex);
          return;
        }

        void handleCaptureFailure(tabId, error);
      });
  }, delay);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) {
    return;
  }

  autoCaptureStateByTabId.set(tab.id, {
    currentUrl: tab.url,
    attemptIndex: 0,
    success: false,
    visitedPageUrls: [],
    runTargetId: null,
    maxPages: null
  });

  try {
    const result = await captureTab(tab.id);
    await continuePagination(tab.id, result);
  } catch (error) {
    await handleCaptureFailure(tab.id, error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || !isIndeedSearchResultsPage(tab.url)) {
    return;
  }

  const currentState = autoCaptureStateByTabId.get(tabId);
  if (currentState?.currentUrl === tab.url && (currentState.success || currentState.attemptIndex === 0)) {
    return;
  }

  autoCaptureStateByTabId.set(tabId, {
    currentUrl: tab.url,
    attemptIndex: 0,
    success: false,
    visitedPageUrls: currentState?.visitedPageUrls ?? [],
    runTargetId: currentState?.runTargetId ?? null,
    maxPages: currentState?.maxPages ?? null
  });
  scheduleAutoCapture(tabId, tab.url, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoCaptureStateByTabId.delete(tabId);
});
