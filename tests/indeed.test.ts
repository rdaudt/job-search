import { describe, expect, it } from "vitest";
import { indeedAdapter } from "../src/shared/indeed.js";
import { listingMatchesRunLocation } from "../src/shared/location-utils.js";

describe("indeedAdapter", () => {
  it("builds a search URL with run target metadata", () => {
    const url = indeedAdapter.buildSearchUrl({
      id: "run-target-1",
      runId: 1,
      searchProfileId: "remote-frontend",
      searchProfileName: "Remote Frontend",
      keywords: "frontend engineer",
      location: "Vancouver, BC",
      remote: true
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

  it("keeps valid remote listings for remote runs with a location scope", () => {
    expect(listingMatchesRunLocation("Remote", "Vancouver, BC", true)).toBe(true);
    expect(listingMatchesRunLocation("Remote in British Columbia", "Vancouver, BC", true)).toBe(true);
    expect(listingMatchesRunLocation("Remote in United States", "Vancouver, BC", true)).toBe(false);
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
});
