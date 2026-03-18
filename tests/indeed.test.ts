import { describe, expect, it } from "vitest";
import { indeedAdapter } from "../src/shared/indeed.js";

describe("indeedAdapter", () => {
  it("builds a search URL with profile hash metadata", () => {
    const url = indeedAdapter.buildSearchUrl({
      id: "remote-frontend",
      name: "Remote Frontend",
      keywords: "frontend engineer",
      location: "Vancouver, BC",
      remote: true
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.indeed.com/jobs");
    expect(parsed.searchParams.get("q")).toContain("frontend engineer");
    expect(parsed.searchParams.get("q")).toContain("remote");
    expect(parsed.searchParams.get("l")).toBe("Vancouver, BC");
    expect(parsed.searchParams.get("jobFinderProfile")).toBe("remote-frontend");
    expect(parsed.hash).toBe("#job-finder-profile=remote-frontend");
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
  });
});
