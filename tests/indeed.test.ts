import { describe, expect, it } from "vitest";
import {
  attachRunTargetMetadata,
  indeedAdapter,
  normalizeIndeedResultsPageUrl,
  parseIndeedPageNumber
} from "../src/shared/indeed.js";
import {
  listingMatchesCanadianScope,
  listingMatchesRunLocation,
  selectIndeedHostForLocation,
  splitJobLocation
} from "../src/shared/location-utils.js";

describe("indeedAdapter", () => {
  it("builds a search URL with run target metadata", () => {
    const url = indeedAdapter.buildSearchUrl({
      id: "run-target-1",
      runId: 1,
      searchProfileId: "remote-frontend",
      searchProfileName: "Remote Frontend",
      keywords: "frontend engineer",
      location: "Vancouver, BC",
      remote: true,
      runMode: "fixed",
      maxPages: 3,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000,
      pagesCaptured: 0,
      status: "pending",
      stopReason: null,
      lastPageNumber: null,
      lastPageUrl: null,
      updatedAt: "2026-03-18T00:00:00.000Z"
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://ca.indeed.com/jobs");
    expect(parsed.searchParams.get("q")).toContain("frontend engineer");
    expect(parsed.searchParams.get("q")).toContain("remote");
    expect(parsed.searchParams.get("l")).toBe("Vancouver, BC");
    expect(parsed.searchParams.get("jobFinderProfile")).toBe("remote-frontend");
    expect(parsed.searchParams.get("jobFinderRunTarget")).toBe("run-target-1");
    expect(parsed.hash).toBe("#job-finder-run-target=run-target-1");
  });

  it("prefers the source job id for dedupe", () => {
    const normalized = indeedAdapter.normalizeListingKey({
      sourceJobId: "abc123",
      url: "https://www.indeed.com/viewjob?jk=ignored&from=search",
      title: "Engineer",
      company: "Acme",
      location: "Remote"
    });

    expect(normalized.sourceJobId).toBe("abc123");
    expect(normalized.dedupeKey).toBe("indeed:abc123");
    expect(normalized.normalizedUrl).toBe("https://www.indeed.com/viewjob?jk=ignored");
    expect(normalized.isLinkable).toBe(true);
  });

  it("filters out obviously wrong-country listing locations", () => {
    expect(listingMatchesRunLocation("Smithfield, NC 27577", "Maple Ridge, BC")).toBe(false);
    expect(listingMatchesRunLocation("Maple Ridge, BC", "Maple Ridge, BC")).toBe(true);
    expect(listingMatchesRunLocation("Hybrid work in Vancouver, BC", "Maple Ridge, BC")).toBe(true);
  });

  it("enforces the Canadian Indeed host and filters non-Canadian listings", () => {
    expect(selectIndeedHostForLocation("")).toBe("ca.indeed.com");
    expect(selectIndeedHostForLocation("Vancouver, BC")).toBe("ca.indeed.com");
    expect(listingMatchesCanadianScope("Vancouver, BC")).toBe(true);
    expect(listingMatchesCanadianScope("Remote", true)).toBe(true);
    expect(listingMatchesCanadianScope("Seattle, WA")).toBe(false);
    expect(listingMatchesCanadianScope("Remote in United States", true)).toBe(false);
  });

  it("keeps valid remote listings for remote runs with a location scope", () => {
    expect(listingMatchesRunLocation("Remote", "Vancouver, BC", true)).toBe(true);
    expect(listingMatchesRunLocation("Remote in British Columbia", "Vancouver, BC", true)).toBe(true);
    expect(listingMatchesRunLocation("Remote in United States", "Vancouver, BC", true)).toBe(false);
  });

  it("splits job locations into city and province while dropping postal codes", () => {
    expect(splitJobLocation("Burnaby, BC V5H 2S8")).toEqual({
      city: "Burnaby",
      province: "BC"
    });
    expect(splitJobLocation("Remote in British Columbia")).toEqual({
      city: "Remote",
      province: "BC"
    });
  });

  it("canonicalizes sponsored links when a job id is present", () => {
    const normalized = indeedAdapter.normalizeListingKey({
      sourceJobId: "abc123",
      url: "https://ca.indeed.com/pagead/clk?mo=r&ad=-6NYlbfkN0Example",
      canonicalUrl: "https://ca.indeed.com/viewjob?jk=abc123",
      title: "Coach",
      company: "Acme",
      location: "Surrey, BC"
    });

    expect(normalized.normalizedUrl).toBe("https://ca.indeed.com/viewjob?jk=abc123");
    expect(normalized.isLinkable).toBe(true);
  });

  it("marks unresolved ad click links as not linkable", () => {
    const normalized = indeedAdapter.normalizeListingKey({
      url: "https://ca.indeed.com/pagead/clk?mo=r&ad=-6NYlbfkN0Example",
      title: "Coach",
      company: "Acme",
      location: "Surrey, BC"
    });

    expect(normalized.normalizedUrl).toBe("https://ca.indeed.com/pagead/clk");
    expect(normalized.isLinkable).toBe(false);
  });

  it("stamps pagination URLs with run target metadata", () => {
    const stamped = attachRunTargetMetadata(
      "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC&start=10",
      {
        id: "run-target-1",
        searchProfileId: "frontend"
      },
    );

    const parsed = new URL(stamped);
    expect(parsed.searchParams.get("jobFinderRunTarget")).toBe("run-target-1");
    expect(parsed.searchParams.get("jobFinderProfile")).toBe("frontend");
    expect(parsed.hash).toBe("#job-finder-run-target=run-target-1");
    expect(parseIndeedPageNumber(stamped)).toBe(2);
  });

  it("normalizes results-page URLs by stripping run and detail params", () => {
    const normalized = normalizeIndeedResultsPageUrl(
      "https://www.indeed.com/jobs?q=backend+engineer+node&l=Seattle%2C+WA&jobFinderProfile=backend-local&jobFinderRunTarget=abc&vjk=f2d81681c9ae7a8f#job-finder-run-target=abc",
    );

    expect(normalized).toBe("https://www.indeed.com/jobs?q=backend+engineer+node&l=Seattle%2C+WA");
  });
});
