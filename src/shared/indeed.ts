import type { CaptureListing, SearchProfile, SourceAdapter } from "./types.js";

const INDEED_SEARCH_URL = "https://www.indeed.com/jobs";

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  ["vjs", "advn", "from", "fromage", "jk", "tk", "vjk"].forEach((param) => {
    if (param !== "jk" && param !== "vjk") {
      parsed.searchParams.delete(param);
    }
  });
  const jobId = parsed.searchParams.get("jk") ?? parsed.searchParams.get("vjk");
  parsed.search = "";
  if (jobId) {
    parsed.pathname = "/viewjob";
    parsed.searchParams.set("jk", jobId);
  }
  return parsed.toString();
}

function extractJobId(url: string, explicitJobId?: string): string | null {
  if (explicitJobId?.trim()) {
    return explicitJobId.trim();
  }
  const parsed = new URL(url);
  return parsed.searchParams.get("jk") ?? parsed.searchParams.get("vjk");
}

function encodeRemoteKeywords(profile: SearchProfile): string {
  return profile.remote ? `${profile.keywords} remote` : profile.keywords;
}

export const indeedAdapter: SourceAdapter = {
  buildSearchUrl(profile) {
    const url = new URL(INDEED_SEARCH_URL);
    url.searchParams.set("q", encodeRemoteKeywords(profile));
    if (profile.location.trim()) {
      url.searchParams.set("l", profile.location.trim());
    }
    url.searchParams.set("jobFinderProfile", profile.id);
    url.hash = `job-finder-profile=${encodeURIComponent(profile.id)}`;
    return url.toString();
  },
  normalizeListingKey(listing: CaptureListing) {
    const sourceJobId = extractJobId(listing.url, listing.sourceJobId);
    const normalizedUrl = normalizeUrl(listing.url);
    return {
      sourceJobId,
      normalizedUrl,
      dedupeKey: sourceJobId ? `indeed:${sourceJobId}` : `indeed:url:${normalizedUrl}`
    };
  },
  mapCaptureToJobRecord(listing) {
    const normalized = this.normalizeListingKey(listing);
    return {
      source: "indeed",
      sourceJobId: normalized.sourceJobId,
      normalizedUrl: normalized.normalizedUrl,
      dedupeKey: normalized.dedupeKey,
      title: listing.title.trim(),
      company: listing.company.trim(),
      location: listing.location.trim(),
      summary: listing.summary?.trim() || null
    };
  }
};
