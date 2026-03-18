type CaptureListing = {
  sourceJobId?: string;
  url: string;
  title: string;
  company: string;
  location: string;
  summary?: string;
};

function textContent(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parseSearchProfileId(): string | null {
  const currentUrl = new URL(window.location.href);
  const queryValue = currentUrl.searchParams.get("jobFinderProfile");
  if (queryValue) {
    return queryValue;
  }

  const fragment = currentUrl.hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  return params.get("job-finder-profile");
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

  const searchProfileId = parseSearchProfileId();
  const listings = extractListings();
  if (!listings.length) {
    sendResponse({ error: "No visible job cards were detected on this page." });
    return false;
  }

  sendResponse({
    payload: {
      source: "indeed",
      searchProfileId: searchProfileId ?? null,
      pageUrl: window.location.href,
      listings
    }
  });
  return true;
});
