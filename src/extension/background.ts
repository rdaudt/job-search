import { attachRunTargetMetadata, normalizeIndeedResultsPageUrl } from "../shared/indeed.js";
import type { CapturePayload, RunTarget, RunTargetStateUpdate } from "../shared/types.js";
import { nextZeroNewPagesCount, resolvePaginationStopReason } from "./pagination.js";
import { resolveRunTargetIdFromUrl } from "./profile-matching.js";

const API_URL = "http://127.0.0.1:4312/api/captures";
const SUMMARY_URL = "http://127.0.0.1:4312/api/summary";
const AUTO_CAPTURE_DELAYS_MS = [1500, 4500, 9000];
const CHALLENGE_CAPTURE_DELAYS_MS = [1500, 4500, 9000, 15000, 30000, 45000];
const autoCaptureStateByTabId = new Map<number, AutoCaptureState>();

type AppSummary = {
  latestRunTargets: RunTarget[];
};

type AutoCaptureState = {
  currentUrl: string;
  currentNormalizedUrl: string;
  attemptIndex: number;
  success: boolean;
  visitedPageUrls: string[];
  runTargetId: string | null;
  runMode: RunTarget["runMode"] | null;
  maxPages: number | null;
  zeroNewJobsThreshold: number | null;
  emergencyMaxPages: number | null;
  consecutiveZeroNewPages: number;
  lastFailureWasChallenge: boolean;
};

type InterruptionKind =
  | "indeed-verification-page"
  | "indeed-signin-gate"
  | "indeed-access-denied";

type CapturePageContext = {
  runTargetId: string | null;
  pageUrl: string;
  pageNumber: number;
  nextPageUrl: string | null;
  listingCount: number;
  isChallengePage: boolean;
  interruptionKind: InterruptionKind | null;
};

type ContentCaptureResponse =
  | {
      payload: Omit<CapturePayload, "runTargetId"> & {
        runTargetId: string | null;
        nextPageUrl: string | null;
        listingCount: number;
        isChallengePage: boolean;
        interruptionKind: InterruptionKind | null;
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
  normalizedPageUrl: string;
  nextPageUrl: string | null;
  normalizedNextPageUrl: string | null;
  listingCount: number;
  isChallengePage: boolean;
};

type CaptureFailure = Error & {
  pageContext?: CapturePageContext;
  runTarget?: RunTarget;
};

function initialAutoCaptureState(url: string): AutoCaptureState {
  return {
    currentUrl: url,
    currentNormalizedUrl: normalizeIndeedResultsPageUrl(url),
    attemptIndex: 0,
    success: false,
    visitedPageUrls: [],
    runTargetId: null,
    runMode: null,
    maxPages: null,
    zeroNewJobsThreshold: null,
    emergencyMaxPages: null,
    consecutiveZeroNewPages: 0,
    lastFailureWasChallenge: false
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function randomDelayMs(baseDelayMs: number, jitterMs: number): number {
  if (jitterMs <= 0) {
    return baseDelayMs;
  }

  return baseDelayMs + Math.floor(Math.random() * (jitterMs + 1));
}

function isRetriableInterruption(kind: InterruptionKind | null | undefined): boolean {
  return kind === "indeed-verification-page" || kind === "indeed-access-denied";
}

async function fetchLatestRunTargets(): Promise<RunTarget[]> {
  const response = await fetch(SUMMARY_URL);
  if (!response.ok) {
    throw new Error(`Could not load run targets from local app: ${response.status}`);
  }

  const summary = (await response.json()) as AppSummary;
  return summary.latestRunTargets;
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
        nextPageUrl: response.payload.nextPageUrl ?? null,
        listingCount: response.payload.listingCount,
        isChallengePage: response.payload.isChallengePage,
        interruptionKind: response.payload.interruptionKind ?? null
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

  const nextPageUrl = pageContext.nextPageUrl ? attachRunTargetMetadata(pageContext.nextPageUrl, runTarget) : null;
  return {
    ...result,
    runTarget,
    pageNumber: pageContext.pageNumber,
    pageUrl: pageContext.pageUrl,
    normalizedPageUrl: normalizeIndeedResultsPageUrl(pageContext.pageUrl),
    nextPageUrl,
    normalizedNextPageUrl: nextPageUrl ? normalizeIndeedResultsPageUrl(nextPageUrl) : null,
    listingCount: pageContext.listingCount,
    isChallengePage: pageContext.isChallengePage
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
  visitedPageUrls.add(result.normalizedPageUrl);
  const consecutiveZeroNewPages = nextZeroNewPagesCount(currentState?.consecutiveZeroNewPages ?? 0, result.inserted);

  const nextState: AutoCaptureState = {
    currentUrl: result.pageUrl,
    currentNormalizedUrl: result.normalizedPageUrl,
    attemptIndex: 0,
    success: true,
    visitedPageUrls: [...visitedPageUrls],
    runTargetId: result.runTarget.id,
    runMode: result.runTarget.runMode,
    maxPages: result.runTarget.maxPages,
    zeroNewJobsThreshold: result.runTarget.zeroNewJobsThreshold,
    emergencyMaxPages: result.runTarget.emergencyMaxPages,
    consecutiveZeroNewPages,
    lastFailureWasChallenge: false
  };
  autoCaptureStateByTabId.set(tabId, nextState);

  const stopReason = resolvePaginationStopReason(
    {
      runMode: result.runTarget.runMode,
      maxPages: result.runTarget.maxPages,
      zeroNewJobsThreshold: result.runTarget.zeroNewJobsThreshold,
      emergencyMaxPages: result.runTarget.emergencyMaxPages,
      consecutiveZeroNewPages,
      visitedPageUrls: [...visitedPageUrls]
    },
    {
      pageNumber: result.pageNumber,
      nextPageUrl: result.nextPageUrl,
      normalizedNextPageUrl: result.normalizedNextPageUrl,
      normalizedCurrentPageUrl: result.normalizedPageUrl,
      inserted: result.inserted,
      isChallengePage: result.isChallengePage
    },
  );

  if (stopReason) {
    await finalizeRunTarget(result.runTarget, "completed", stopReason, result.pageNumber, result.pageUrl);
    return;
  }

  if (!result.nextPageUrl) {
    await finalizeRunTarget(result.runTarget, "completed", "no-next-page", result.pageNumber, result.pageUrl);
    return;
  }

  await wait(randomDelayMs(result.runTarget.pageDelayMs, result.runTarget.pageDelayJitterMs));
  await chrome.tabs.update(tabId, { url: result.nextPageUrl });
}

async function handleCaptureFailure(tabId: number, error: unknown): Promise<void> {
  const typedError = error instanceof Error ? (error as CaptureFailure) : new Error(String(error));
  const currentState = autoCaptureStateByTabId.get(tabId);
  const normalizedFailurePageUrl = typedError.pageContext?.pageUrl
    ? normalizeIndeedResultsPageUrl(typedError.pageContext.pageUrl)
    : null;
  if (
    currentState?.success &&
    normalizedFailurePageUrl &&
    currentState.visitedPageUrls.includes(normalizedFailurePageUrl)
  ) {
    return;
  }

  console.error("Capture failed", typedError);
  chrome.action.setBadgeBackgroundColor({ color: "#9d0208", tabId });
  chrome.action.setBadgeText({ tabId, text: "!" });

  if (typedError.runTarget) {
    const stopReason =
      typedError.pageContext?.interruptionKind ??
      (typedError.pageContext?.isChallengePage
        ? "challenge-detected"
        : typedError.message.includes("No visible job cards")
          ? "no-job-cards-detected"
          : "capture-failed");
    await finalizeRunTarget(
      typedError.runTarget,
      typedError.pageContext?.interruptionKind || typedError.pageContext?.isChallengePage ? "completed" : "failed",
      stopReason,
      typedError.pageContext?.pageNumber,
      typedError.pageContext?.pageUrl,
    ).catch((stateError) => {
      console.error("Failed to report run target failure", stateError);
    });
  }
}

function scheduleAutoCapture(tabId: number, url: string, attemptIndex: number): void {
  const currentState = autoCaptureStateByTabId.get(tabId);
  const retrySchedule = currentState?.lastFailureWasChallenge ? CHALLENGE_CAPTURE_DELAYS_MS : AUTO_CAPTURE_DELAYS_MS;
  const delay = retrySchedule[attemptIndex];
  if (delay === undefined) {
    return;
  }

  globalThis.setTimeout(() => {
    const latestState = autoCaptureStateByTabId.get(tabId);
    if (!latestState || latestState.currentUrl !== url || latestState.success || latestState.attemptIndex !== attemptIndex) {
      return;
    }

    void captureTab(tabId)
      .then((result) => continuePagination(tabId, result))
      .catch((error) => {
        const interruptionKind =
          error instanceof Error ? (error as CaptureFailure).pageContext?.interruptionKind : null;
        const challengeFailure =
          error instanceof Error &&
          ((error as CaptureFailure).pageContext?.isChallengePage === true || isRetriableInterruption(interruptionKind));
        const activeSchedule = challengeFailure ? CHALLENGE_CAPTURE_DELAYS_MS : retrySchedule;
        const nextAttemptIndex = attemptIndex + 1;
        if (activeSchedule[nextAttemptIndex] !== undefined) {
          autoCaptureStateByTabId.set(tabId, {
            ...(latestState ?? initialAutoCaptureState(url)),
            currentUrl: url,
            currentNormalizedUrl: normalizeIndeedResultsPageUrl(url),
            attemptIndex: nextAttemptIndex,
            success: false,
            lastFailureWasChallenge: challengeFailure
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

  autoCaptureStateByTabId.set(tab.id, initialAutoCaptureState(tab.url));

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
  const normalizedTabUrl = normalizeIndeedResultsPageUrl(tab.url);
  if (
    currentState &&
    (currentState.currentNormalizedUrl === normalizedTabUrl ||
      currentState.visitedPageUrls.includes(normalizedTabUrl)) &&
    (currentState.success || currentState.attemptIndex === 0)
  ) {
    return;
  }

  autoCaptureStateByTabId.set(tabId, {
    ...(currentState ?? initialAutoCaptureState(tab.url)),
    currentUrl: tab.url,
    currentNormalizedUrl: normalizedTabUrl,
    attemptIndex: 0,
    success: false,
    lastFailureWasChallenge: false
  });
  scheduleAutoCapture(tabId, tab.url, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoCaptureStateByTabId.delete(tabId);
});
