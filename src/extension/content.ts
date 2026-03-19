import { parseIndeedPageNumber } from "../shared/indeed.js";

type CaptureListing = {
  sourceJobId?: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  company: string;
  location: string;
  summary?: string;
};

type InterruptionKind =
  | "indeed-verification-page"
  | "indeed-signin-gate"
  | "indeed-access-denied";

function textContent(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parseRunTargetId(): string | null {
  const currentUrl = new URL(window.location.href);
  const queryValue = currentUrl.searchParams.get("jobFinderRunTarget");
  if (queryValue) {
    return queryValue;
  }

  const fragment = currentUrl.hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  return params.get("job-finder-run-target");
}

function absoluteUrl(href: string | null): string | null {
  if (!href) {
    return null;
  }
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return null;
  }
}

function buildCanonicalUrl(sourceJobId: string | undefined, href: string): string | undefined {
  if (!sourceJobId) {
    return undefined;
  }

  try {
    const url = new URL(href);
    const canonical = new URL(url.origin);
    canonical.pathname = "/viewjob";
    canonical.searchParams.set("jk", sourceJobId);
    return canonical.toString();
  } catch {
    return undefined;
  }
}

function nextPageUrl(): string | null {
  const nextLink =
    document.querySelector<HTMLAnchorElement>("a[data-testid='pagination-page-next']") ??
    document.querySelector<HTMLAnchorElement>("[data-testid='pagination-page-next'] a") ??
    document.querySelector<HTMLAnchorElement>("a[aria-label*='Next']") ??
    document.querySelector<HTMLAnchorElement>("a[aria-label*='next']") ??
    document.querySelector<HTMLAnchorElement>("a[aria-label='Next Page']") ??
    document.querySelector<HTMLAnchorElement>("a[aria-label='Next page']") ??
    document.querySelector<HTMLAnchorElement>("a[rel='next']") ??
    document.querySelector<HTMLAnchorElement>("nav[aria-label*='Pagination'] a[href*='start=']") ??
    document.querySelector<HTMLAnchorElement>("nav a[href*='/jobs'][aria-label*='Page']");
  return absoluteUrl(nextLink?.getAttribute("href") ?? null);
}

function detectInterruptionKind(): InterruptionKind | null {
  const title = document.title.trim().toLowerCase();
  const bodyText = document.body?.textContent?.replace(/\s+/g, " ").toLowerCase() ?? "";
  const currentUrl = window.location.href.toLowerCase();

  if (currentUrl.includes("secure.indeed.com/auth") || title.includes("sign in | indeed accounts")) {
    return "indeed-signin-gate";
  }

  if (title.includes("blocked") || bodyText.includes("access denied") || bodyText.includes("request has been blocked")) {
    return "indeed-access-denied";
  }

  if (!bodyText) {
    return null;
  }

  const hasChallengeMarker = Boolean(
    document.querySelector("iframe[src*='captcha'], iframe[src*='challenge'], form[action*='captcha'], input[name*='captcha'], #challenge-running"),
  );
  const hasVerificationSignal =
    title.includes("just a moment") ||
    title.includes("security check") ||
    title.includes("verify you are human") ||
    bodyText.includes("verify you are human") ||
    bodyText.includes("complete the security check") ||
    bodyText.includes("enter the characters you see below") ||
    bodyText.includes("just a moment") ||
    bodyText.includes("additional verification required") ||
    bodyText.includes("enable javascript to complete the security check") ||
    bodyText.includes("unusual traffic");

  if (
    hasChallengeMarker ||
    (hasVerificationSignal && !document.querySelector("[data-jk], .job_seen_beacon, [data-testid='slider_item']"))
  ) {
    return "indeed-verification-page";
  }

  return null;
}

function extractListings(): CaptureListing[] {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-jk], .job_seen_beacon, [data-testid='slider_item']"),
  );

  const seenKeys = new Set<string>();
  const listings: CaptureListing[] = [];

  for (const card of cards) {
    const titleLink =
      card.querySelector<HTMLAnchorElement>("a[data-jk], h2 a, a.jcs-JobTitle, [data-testid='job-title'] a") ??
      card.querySelector<HTMLAnchorElement>("a");
    const href = absoluteUrl(titleLink?.getAttribute("href") ?? null);
    const sourceJobId =
      card.getAttribute("data-jk") ??
      titleLink?.getAttribute("data-jk") ??
      (href ? new URL(href).searchParams.get("jk") ?? undefined : undefined);
    const canonicalUrl = href ? buildCanonicalUrl(sourceJobId, href) : undefined;

    if (!href) {
      continue;
    }

    const dedupeHint = sourceJobId ?? href;
    if (seenKeys.has(dedupeHint)) {
      continue;
    }
    seenKeys.add(dedupeHint);

    const title =
      textContent(titleLink) ||
      textContent(card.querySelector("[title]")) ||
      "Untitled role";
    const company =
      textContent(card.querySelector("[data-testid='company-name']")) ||
      textContent(card.querySelector(".companyName")) ||
      textContent(card.querySelector("[data-testid='company-title']"));
    const location =
      textContent(card.querySelector("[data-testid='text-location']")) ||
      textContent(card.querySelector(".companyLocation"));
    const summary =
      textContent(card.querySelector("[data-testid='job-snippet']")) ||
      textContent(card.querySelector(".job-snippet"));

    listings.push({
      sourceJobId,
      url: href,
      canonicalUrl,
      title,
      company,
      location,
      summary: summary || undefined
    });
  }

  return listings;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture-visible-jobs") {
    return false;
  }

  const runTargetId = parseRunTargetId();
  const pageUrl = window.location.href;
  const pageNumber = parseIndeedPageNumber(pageUrl);
  const nextUrl = nextPageUrl();
  const listings = extractListings();
  const interruptionKind = detectInterruptionKind();
  const challengeDetected = interruptionKind === "indeed-verification-page" || interruptionKind === "indeed-access-denied";
  if (!listings.length) {
    sendResponse({
      error:
        interruptionKind === "indeed-verification-page"
          ? "Indeed verification page detected."
          : interruptionKind === "indeed-signin-gate"
            ? "Indeed sign-in page detected."
            : interruptionKind === "indeed-access-denied"
              ? "Indeed access denied page detected."
              : "No visible job cards were detected on this page.",
      pageContext: {
        runTargetId: runTargetId ?? null,
        pageUrl,
        pageNumber,
        nextPageUrl: nextUrl,
        listingCount: 0,
        isChallengePage: challengeDetected,
        interruptionKind
      }
    });
    return false;
  }

  sendResponse({
    payload: {
      source: "indeed",
      runTargetId: runTargetId ?? null,
      pageUrl,
      pageNumber,
      nextPageUrl: nextUrl,
      listingCount: listings.length,
      isChallengePage: challengeDetected,
      interruptionKind,
      listings
    }
  });
  return true;
});
