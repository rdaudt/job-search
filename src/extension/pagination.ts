import type { RunMode } from "../shared/types.js";

export type PaginationPageState = {
  pageNumber: number;
  nextPageUrl: string | null;
  normalizedNextPageUrl: string | null;
  normalizedCurrentPageUrl: string;
  inserted: number;
  isChallengePage: boolean;
};

export type PaginationRuntimeState = {
  runMode: RunMode;
  maxPages: number;
  zeroNewJobsThreshold: number;
  emergencyMaxPages: number;
  consecutiveZeroNewPages: number;
  visitedPageUrls: string[];
};

export function nextZeroNewPagesCount(currentCount: number, inserted: number): number {
  return inserted > 0 ? 0 : currentCount + 1;
}

export function resolvePaginationStopReason(
  runtime: PaginationRuntimeState,
  page: PaginationPageState,
): string | null {
  if (page.isChallengePage) {
    return "challenge-detected";
  }

  if (runtime.runMode === "fixed" && page.pageNumber >= runtime.maxPages) {
    return "page-limit-reached";
  }

  if (page.pageNumber >= runtime.emergencyMaxPages) {
    return "emergency-page-cap";
  }

  if (!page.nextPageUrl || !page.normalizedNextPageUrl) {
    return "no-next-page";
  }

  if (runtime.visitedPageUrls.includes(page.normalizedNextPageUrl)) {
    return "repeated-page-url";
  }

  if (runtime.runMode === "auto" && runtime.consecutiveZeroNewPages >= runtime.zeroNewJobsThreshold) {
    return "zero-new-jobs-threshold";
  }

  return null;
}
