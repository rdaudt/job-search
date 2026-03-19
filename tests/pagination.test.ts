import { describe, expect, it } from "vitest";
import { nextZeroNewPagesCount, resolvePaginationStopReason } from "../src/extension/pagination.js";

describe("pagination stop rules", () => {
  it("stops fixed mode at the configured page limit", () => {
    expect(
      resolvePaginationStopReason(
        {
          runMode: "fixed",
          maxPages: 3,
          zeroNewJobsThreshold: 2,
          emergencyMaxPages: 50,
          consecutiveZeroNewPages: 0,
          visitedPageUrls: []
        },
        {
          pageNumber: 3,
          nextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=30",
          normalizedNextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=30",
          normalizedCurrentPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=20",
          inserted: 4,
          isChallengePage: false
        },
      ),
    ).toBe("page-limit-reached");
  });

  it("stops auto mode after consecutive zero-new pages", () => {
    const consecutiveZeroNewPages = nextZeroNewPagesCount(1, 0);
    expect(
      resolvePaginationStopReason(
        {
          runMode: "auto",
          maxPages: 3,
          zeroNewJobsThreshold: 2,
          emergencyMaxPages: 50,
          consecutiveZeroNewPages,
          visitedPageUrls: []
        },
        {
          pageNumber: 4,
          nextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=40",
          normalizedNextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=40",
          normalizedCurrentPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=30",
          inserted: 0,
          isChallengePage: false
        },
      ),
    ).toBe("zero-new-jobs-threshold");
  });

  it("stops on repeated normalized next-page URLs", () => {
    expect(
      resolvePaginationStopReason(
        {
          runMode: "auto",
          maxPages: 3,
          zeroNewJobsThreshold: 2,
          emergencyMaxPages: 50,
          consecutiveZeroNewPages: 0,
          visitedPageUrls: ["https://ca.indeed.com/jobs?q=frontend&start=10"]
        },
        {
          pageNumber: 1,
          nextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=10&jobFinderRunTarget=abc",
          normalizedNextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=10",
          normalizedCurrentPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=0",
          inserted: 3,
          isChallengePage: false
        },
      ),
    ).toBe("repeated-page-url");
  });

  it("stops on challenge detection before other rules", () => {
    expect(
      resolvePaginationStopReason(
        {
          runMode: "auto",
          maxPages: 3,
          zeroNewJobsThreshold: 2,
          emergencyMaxPages: 50,
          consecutiveZeroNewPages: 2,
          visitedPageUrls: []
        },
        {
          pageNumber: 2,
          nextPageUrl: null,
          normalizedNextPageUrl: null,
          normalizedCurrentPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=10",
          inserted: 0,
          isChallengePage: true
        },
      ),
    ).toBe("challenge-detected");
  });

  it("stops auto mode at the emergency ceiling", () => {
    expect(
      resolvePaginationStopReason(
        {
          runMode: "auto",
          maxPages: 3,
          zeroNewJobsThreshold: 2,
          emergencyMaxPages: 50,
          consecutiveZeroNewPages: 0,
          visitedPageUrls: []
        },
        {
          pageNumber: 50,
          nextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=500",
          normalizedNextPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=500",
          normalizedCurrentPageUrl: "https://ca.indeed.com/jobs?q=frontend&start=490",
          inserted: 1,
          isChallengePage: false
        },
      ),
    ).toBe("emergency-page-cap");
  });
});
