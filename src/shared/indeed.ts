import type { CaptureListing, RunTarget, SearchProfile, SourceAdapter } from "./types.js";
import { selectIndeedHostForLocation } from "./location-utils.js";

function buildCanonicalViewJobUrl(url: URL, jobId: string): string {
  const canonical = new URL(url.origin);
  canonical.pathname = "/viewjob";
  canonical.searchParams.set("jk", jobId);
  return canonical.toString();
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  ["vjs", "advn", "from", "fromage", "jk", "tk", "vjk"].forEach((param) => {
    if (param !== "jk" && param !== "vjk") {
      parsed.searchParams.delete(param);
    }
  });
  const jobId = parsed.searchParams.get("jk") ?? parsed.searchParams.get("vjk");
  if (jobId) {
    return buildCanonicalViewJobUrl(parsed, jobId);
  }

  parsed.search = "";
  if (parsed.pathname === "/pagead/clk") {
    return parsed.toString();
  }

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

function encodeRemoteKeywords(profile: Pick<SearchProfile, "keywords" | "remote">): string {
  return profile.remote ? `${profile.keywords} remote` : profile.keywords;
}

export function attachRunTargetMetadata(
  pageUrl: string,
  runTarget: Pick<RunTarget, "id" | "searchProfileId">,
): string {
  const url = new URL(pageUrl);
  url.searchParams.set("jobFinderProfile", runTarget.searchProfileId);
  url.searchParams.set("jobFinderRunTarget", runTarget.id);
  url.hash = `job-finder-run-target=${encodeURIComponent(runTarget.id)}`;
  return url.toString();
}

export function parseIndeedPageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const startValue = Number(url.searchParams.get("start") ?? "0");
  if (!Number.isFinite(startValue) || startValue < 0) {
    return 1;
  }
  return Math.floor(startValue / 10) + 1;
}

export const indeedAdapter: SourceAdapter = {
  buildSearchUrl(runTarget: RunTarget) {
    const url = new URL(`https://${selectIndeedHostForLocation(runTarget.location)}/jobs`);
    url.searchParams.set("q", encodeRemoteKeywords(runTarget));
    if (runTarget.location.trim()) {
      url.searchParams.set("l", runTarget.location.trim());
    }
    url.searchParams.set("jobFinderProfile", runTarget.searchProfileId);
    url.searchParams.set("jobFinderRunTarget", runTarget.id);
    url.hash = `job-finder-run-target=${encodeURIComponent(runTarget.id)}`;
    return url.toString();
  },
  normalizeListingKey(listing: CaptureListing) {
    const sourceJobId = extractJobId(listing.canonicalUrl ?? listing.url, listing.sourceJobId);
    const normalizedUrl = normalizeUrl(listing.canonicalUrl ?? listing.url);
    return {
      sourceJobId,
      normalizedUrl,
      dedupeKey: sourceJobId ? `indeed:${sourceJobId}` : `indeed:url:${normalizedUrl}`,
      isLinkable: !normalizedUrl.includes("/pagead/clk")
    };
  },
  mapCaptureToJobRecord(listing) {
    const normalized = this.normalizeListingKey(listing);
    return {
      source: "indeed",
      sourceJobId: normalized.sourceJobId,
      normalizedUrl: normalized.normalizedUrl,
      dedupeKey: normalized.dedupeKey,
      isLinkable: normalized.isLinkable,
      title: listing.title.trim(),
      company: listing.company.trim(),
      location: listing.location.trim(),
      summary: listing.summary?.trim() || null
    };
  }
};
