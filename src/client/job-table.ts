import type { JobRecord } from "../shared/types.js";

export const relevanceFilterValues = [
  "all",
  "relevant",
  "borderline",
  "irrelevant",
  "pending",
  "failed",
  "unreviewed"
] as const;

export type RelevanceFilterValue = (typeof relevanceFilterValues)[number];

export const jobSortFields = [
  "title",
  "company",
  "location",
  "relevance",
  "explanation",
  "searches",
  "runLocations",
  "lastSeen",
  "status"
] as const;

export type JobSortField = (typeof jobSortFields)[number];
export type SortDirection = "asc" | "desc";

const relevanceRank: Record<string, number> = {
  relevant: 0,
  borderline: 1,
  pending: 2,
  unreviewed: 3,
  failed: 4,
  irrelevant: 5
};

const jobStatusRank: Record<JobRecord["status"], number> = {
  new: 0,
  reviewed: 1,
  saved: 2,
  ignored: 3
};

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getRelevanceKey(job: JobRecord): keyof typeof relevanceRank {
  if (job.relevanceStatus === "pending") {
    return "pending";
  }
  if (job.relevanceStatus === "failed") {
    return "failed";
  }
  if (job.relevanceStatus === "unreviewed") {
    return "unreviewed";
  }
  if (job.relevanceLabel === "relevant") {
    return "relevant";
  }
  if (job.relevanceLabel === "borderline") {
    return "borderline";
  }
  return "irrelevant";
}

export function getRelevanceFlagStatus(job: JobRecord): string {
  if (job.relevanceStatus === "pending") {
    return "Pending AI review";
  }
  if (job.relevanceStatus === "failed") {
    return "AI failed";
  }
  if (job.relevanceStatus === "unreviewed") {
    return "Unreviewed";
  }
  if (job.relevanceLabel === "relevant") {
    return "Relevant";
  }
  if (job.relevanceLabel === "borderline") {
    return "Borderline";
  }
  return "Irrelevant";
}

export function getRelevanceExplanation(job: JobRecord): string {
  if (job.relevanceReason?.trim()) {
    return job.relevanceReason.trim();
  }
  if (job.relevanceStatus === "pending") {
    return "Pending AI review";
  }
  if (job.relevanceStatus === "failed") {
    return "AI classification failed";
  }
  if (job.relevanceStatus === "unreviewed") {
    return "Not sent for AI review";
  }
  return "No explanation returned";
}

export function getRelevanceFilterValue(job: JobRecord): RelevanceFilterValue {
  if (job.relevanceStatus === "pending") {
    return "pending";
  }
  if (job.relevanceStatus === "failed") {
    return "failed";
  }
  if (job.relevanceStatus === "unreviewed") {
    return "unreviewed";
  }
  return job.relevanceLabel ?? "unreviewed";
}

export function matchesRelevanceFilter(job: JobRecord, filter: RelevanceFilterValue): boolean {
  if (filter === "all") {
    return true;
  }
  return getRelevanceFilterValue(job) === filter;
}

export function getDefaultSortDirection(field: JobSortField): SortDirection {
  if (field === "lastSeen") {
    return "desc";
  }
  return "asc";
}

function compareByField(a: JobRecord, b: JobRecord, field: JobSortField): number {
  switch (field) {
    case "title":
      return compareText(a.title, b.title);
    case "company":
      return compareText(a.company || "", b.company || "");
    case "location":
      return compareText(a.location || "", b.location || "");
    case "relevance":
      return relevanceRank[getRelevanceKey(a)] - relevanceRank[getRelevanceKey(b)];
    case "explanation":
      return compareText(getRelevanceExplanation(a), getRelevanceExplanation(b));
    case "searches":
      return compareText(a.matchingSearchProfiles.join(", "), b.matchingSearchProfiles.join(", "));
    case "runLocations":
      return compareText(a.matchingRunLocations.join(", "), b.matchingRunLocations.join(", "));
    case "lastSeen":
      return new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime();
    case "status":
      return jobStatusRank[a.status] - jobStatusRank[b.status];
  }
}

export function sortJobs(jobs: JobRecord[], field: JobSortField, direction: SortDirection): JobRecord[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return jobs
    .map((job, index) => ({ job, index }))
    .sort((left, right) => {
      const primary = compareByField(left.job, right.job, field) * multiplier;
      if (primary !== 0) {
        return primary;
      }

      const secondary =
        field === "lastSeen"
          ? compareText(left.job.title, right.job.title)
          : new Date(right.job.lastSeenAt).getTime() - new Date(left.job.lastSeenAt).getTime();
      if (secondary !== 0) {
        return secondary;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.job);
}
