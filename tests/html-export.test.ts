import { describe, expect, it } from "vitest";
import type { JobRecord } from "../src/shared/types.js";
import { renderJobsHtmlExport } from "../src/server/export/html-export.js";

function buildJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: 1,
    source: "indeed",
    sourceJobId: null,
    dedupeKey: "job-1",
    normalizedUrl: "https://ca.indeed.com/viewjob?jk=job-1",
    isLinkable: true,
    title: "Fitness Coach",
    company: "Acme Fitness",
    location: "Vancouver, BC",
    summary: "Coach clients",
    firstCapturedAt: "2026-03-19T10:00:00.000Z",
    lastSeenAt: "2026-03-19T10:00:00.000Z",
    status: "new",
    relevanceStatus: "complete",
    relevanceLabel: "relevant",
    relevanceReason: "Strong title match.",
    effectiveRelevanceStatus: "complete",
    effectiveRelevanceLabel: "relevant",
    effectiveRelevanceExplanation: "Strong title match.",
    hasUserOverride: false,
    userOverrideLabel: null,
    userOverrideNote: null,
    matchingSearchProfiles: ["Fitness"],
    matchingRunLocations: ["Vancouver, BC"],
    ...overrides
  };
}

describe("HTML export", () => {
  it("renders a self-contained HTML table with sorting controls and job link", () => {
    const html = renderJobsHtmlExport(
      [
        buildJob({
          title: "Fitness Coach",
          effectiveRelevanceExplanation: "Strong title match for a coaching role."
        })
      ],
      "2026-03-19T10:00:00.000Z"
    );

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Relevant jobs snapshot");
    expect(html).toContain("data-sort-field=\"title\"");
    expect(html).toContain("href=\"https://ca.indeed.com/viewjob?jk=job-1\"");
    expect(html).toContain("Strong title match for a coaching role.");
    expect(html).toContain(">1</td>");
  });

  it("renders an empty state when there are no relevant jobs to export", () => {
    const html = renderJobsHtmlExport([], "2026-03-19T10:00:00.000Z");

    expect(html).toContain("No relevant jobs available for export.");
  });
});
