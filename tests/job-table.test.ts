import { describe, expect, it } from "vitest";
import type { JobRecord } from "../src/shared/types.js";
import {
  EXPLANATION_PREVIEW_LENGTH,
  getDefaultSortDirection,
  getJobCity,
  getJobProvince,
  getRelevanceExplanation,
  getRelevanceExplanationPreview,
  getRelevanceFilterValue,
  getRelevanceFlagStatus,
  matchesRelevanceFilter,
  sortJobs
} from "../src/client/job-table.js";

function buildJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: 1,
    source: "indeed",
    sourceJobId: null,
    dedupeKey: "job-1",
    normalizedUrl: "https://ca.indeed.com/viewjob?jk=job-1",
    isLinkable: true,
    title: "Fitness Coach",
    company: "Acme",
    location: "Vancouver, BC",
    locationCity: "Vancouver",
    locationProvince: "BC",
    summary: "Coach clients",
    firstCapturedAt: "2026-03-19T10:00:00.000Z",
    lastSeenAt: "2026-03-19T10:00:00.000Z",
    status: "new",
    relevanceStatus: "complete",
    relevanceLabel: "relevant",
    relevanceReason: "Strong title match",
    effectiveRelevanceStatus: "complete",
    effectiveRelevanceLabel: "relevant",
    effectiveRelevanceExplanation: "Strong title match",
    hasUserOverride: false,
    userOverrideLabel: null,
    userOverrideNote: null,
    matchingSearchProfiles: ["Fitness"],
    matchingRunLocations: ["Vancouver, BC"],
    ...overrides
  };
}

describe("job table helpers", () => {
  it("derives relevance labels and explanation placeholders", () => {
    expect(
      getRelevanceFlagStatus(
        buildJob({
          relevanceStatus: "pending",
          relevanceLabel: null,
          relevanceReason: null,
          effectiveRelevanceStatus: "pending",
          effectiveRelevanceLabel: null,
          effectiveRelevanceExplanation: null
        })
      )
    ).toBe("Pending AI review");

    expect(
      getRelevanceExplanation(
        buildJob({
          relevanceStatus: "failed",
          relevanceLabel: null,
          relevanceReason: null,
          effectiveRelevanceStatus: "failed",
          effectiveRelevanceLabel: null,
          effectiveRelevanceExplanation: null
        })
      )
    ).toBe("AI classification failed");

    expect(
      getRelevanceExplanation(
        buildJob({
          relevanceStatus: "unreviewed",
          relevanceLabel: null,
          relevanceReason: null,
          effectiveRelevanceStatus: "unreviewed",
          effectiveRelevanceLabel: null,
          effectiveRelevanceExplanation: null
        })
      )
    ).toBe("Not sent for AI review");
  });

  it("filters by derived relevance state", () => {
    const irrelevant = buildJob({
      relevanceStatus: "complete",
      relevanceLabel: "irrelevant",
      relevanceReason: "Wrong domain",
      effectiveRelevanceStatus: "complete",
      effectiveRelevanceLabel: "irrelevant",
      effectiveRelevanceExplanation: "Wrong domain"
    });

    expect(getRelevanceFilterValue(irrelevant)).toBe("irrelevant");
    expect(matchesRelevanceFilter(irrelevant, "irrelevant")).toBe(true);
    expect(matchesRelevanceFilter(irrelevant, "relevant")).toBe(false);
  });

  it("sorts by relevance first and last seen descending as tie-breaker", () => {
    const jobs = [
      buildJob({
        id: 1,
        title: "Older Relevant",
        lastSeenAt: "2026-03-18T10:00:00.000Z",
        relevanceStatus: "complete",
        relevanceLabel: "relevant",
        effectiveRelevanceStatus: "complete",
        effectiveRelevanceLabel: "relevant"
      }),
      buildJob({
        id: 2,
        title: "Pending Job",
        lastSeenAt: "2026-03-19T10:00:00.000Z",
        relevanceStatus: "pending",
        relevanceLabel: null,
        relevanceReason: null,
        effectiveRelevanceStatus: "pending",
        effectiveRelevanceLabel: null,
        effectiveRelevanceExplanation: null
      }),
      buildJob({
        id: 3,
        title: "Newer Relevant",
        lastSeenAt: "2026-03-19T11:00:00.000Z",
        relevanceStatus: "complete",
        relevanceLabel: "relevant",
        effectiveRelevanceStatus: "complete",
        effectiveRelevanceLabel: "relevant"
      })
    ];

    expect(sortJobs(jobs, "relevance", "asc").map((job) => job.title)).toEqual([
      "Newer Relevant",
      "Older Relevant",
      "Pending Job"
    ]);
  });

  it("uses descending as the default direction for last seen only", () => {
    expect(getDefaultSortDirection("lastSeen")).toBe("desc");
    expect(getDefaultSortDirection("title")).toBe("asc");
  });

  it("shows override-derived relevance and explanation when present", () => {
    const overridden = buildJob({
      effectiveRelevanceStatus: "complete",
      effectiveRelevanceLabel: "relevant",
      effectiveRelevanceExplanation: "Leadership-track roles are in scope.",
      hasUserOverride: true,
      userOverrideLabel: "relevant",
      userOverrideNote: "Leadership-track roles are in scope."
    });

    expect(getRelevanceFlagStatus(overridden)).toBe("Relevant");
    expect(getRelevanceExplanation(overridden)).toBe("Leadership-track roles are in scope.");
  });

  it("falls back to parsing city and province from the raw location string", () => {
    const job = buildJob({
      location: "Burnaby, BC V5H 2S8",
      locationCity: "",
      locationProvince: ""
    });

    expect(getJobCity(job)).toBe("Burnaby");
    expect(getJobProvince(job)).toBe("BC");
  });

  it("returns a truncated explanation preview when the explanation exceeds 240 characters", () => {
    const longExplanation = "A".repeat(EXPLANATION_PREVIEW_LENGTH + 25);
    const preview = getRelevanceExplanationPreview(
      buildJob({
        effectiveRelevanceExplanation: longExplanation
      })
    );

    expect(preview.isTruncated).toBe(true);
    expect(preview.text).toBe(`${"A".repeat(EXPLANATION_PREVIEW_LENGTH)}\u2026`);
  });
});
