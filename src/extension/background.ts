import { resolveSearchProfileIdFromUrl } from "./profile-matching.js";

const API_URL = "http://127.0.0.1:4312/api/captures";
const SUMMARY_URL = "http://127.0.0.1:4312/api/summary";
const AUTO_CAPTURE_DELAYS_MS = [1500, 4500, 9000];
const autoCaptureStateByTabId = new Map<number, { url: string; attemptIndex: number; success: boolean }>();

type SearchProfile = {
  id: string;
  name: string;
  keywords: string;
  location: string;
  remote: boolean;
};

type AppSummary = {
  searches: SearchProfile[];
};

async function inferSearchProfileId(pageUrl: string): Promise<string | null> {
  const response = await fetch(SUMMARY_URL);
  if (!response.ok) {
    throw new Error(`Could not load search profiles from local app: ${response.status}`);
  }

  const summary = (await response.json()) as AppSummary;
  return resolveSearchProfileIdFromUrl(pageUrl, summary.searches);
}

async function captureTab(tabId: number): Promise<{ inserted: number; updated: number }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const response = await chrome.tabs.sendMessage(tabId, { type: "capture-visible-jobs" });
    if (response?.error) {
      throw new Error(response.error);
    }
    if (!response?.payload) {
      throw new Error("No capture payload returned from content script.");
    }

    const searchProfileId =
      response.payload.searchProfileId ?? (await inferSearchProfileId(response.payload.pageUrl));
    if (!searchProfileId) {
      throw new Error("Could not match this Indeed tab to an imported search profile.");
    }

    const postResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...response.payload,
        searchProfileId
      })
    });

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      throw new Error(errorText || "Failed to send capture payload.");
    }

    const result = (await postResponse.json()) as { inserted: number; updated: number };
    const badgeText = `${result.inserted + result.updated}`;
    chrome.action.setBadgeBackgroundColor({ color: "#1b4332", tabId });
    chrome.action.setBadgeText({ tabId, text: badgeText });
    if (tab.url) {
      autoCaptureStateByTabId.set(tabId, { url: tab.url, attemptIndex: 0, success: true });
    }
    return result;
  } catch (error) {
    console.error("Capture failed", error);
    chrome.action.setBadgeBackgroundColor({ color: "#9d0208", tabId });
    chrome.action.setBadgeText({ tabId, text: "!" });
    throw error;
  }
}

function isIndeedSearchResultsPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("indeed.com") && parsed.pathname.startsWith("/jobs");
  } catch {
    return false;
  }
}

function scheduleAutoCapture(tabId: number, url: string, attemptIndex: number): void {
  const delay = AUTO_CAPTURE_DELAYS_MS[attemptIndex];
  if (delay === undefined) {
    return;
  }

  globalThis.setTimeout(() => {
    const currentState = autoCaptureStateByTabId.get(tabId);
    if (!currentState || currentState.url !== url || currentState.success || currentState.attemptIndex !== attemptIndex) {
      return;
    }

    void captureTab(tabId).catch(() => {
      const nextAttemptIndex = attemptIndex + 1;
      if (AUTO_CAPTURE_DELAYS_MS[nextAttemptIndex] === undefined) {
        return;
      }

      autoCaptureStateByTabId.set(tabId, {
        url,
        attemptIndex: nextAttemptIndex,
        success: false
      });
      scheduleAutoCapture(tabId, url, nextAttemptIndex);
    });
  }, delay);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  await captureTab(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || !isIndeedSearchResultsPage(tab.url)) {
    return;
  }

  const currentState = autoCaptureStateByTabId.get(tabId);
  if (currentState?.url === tab.url) {
    return;
  }

  autoCaptureStateByTabId.set(tabId, {
    url: tab.url,
    attemptIndex: 0,
    success: false
  });
  scheduleAutoCapture(tabId, tab.url, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoCaptureStateByTabId.delete(tabId);
});
