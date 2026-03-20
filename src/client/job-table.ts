import type { JobRecord } from "../shared/types.js";
import { splitJobLocation } from "../shared/location-utils.js";

export const filterableJobFields = [
  "company",
  "city",
  "province",
  "relevance",
  "searches",
  "runLocations"
] as const;

export type FilterableJobField = (typeof filterableJobFields)[number];
export type ActiveColumnFilters = Partial<Record<FilterableJobField, string[]>>;

export type FilterOption = {
  value: string;
  count: number;
  selected: boolean;
};

export const jobSortFields = [
  "title",
  "company",
  "city",
  "province",
  "relevance",
  "explanation",
  "searches",
  "runLocations",
  "lastSeen",
  "status"
] as const;

export type JobSortField = (typeof jobSortFields)[number];
export type SortDirection = "asc" | "desc";
export const EXPLANATION_PREVIEW_LENGTH = 240;

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

export function getJobCity(job: JobRecord): string {
  return job.locationCity || splitJobLocation(job.location || "").city;
}

export function getJobProvince(job: JobRecord): string {
  return job.locationProvince || splitJobLocation(job.location || "").province;
}

function getRelevanceKey(job: JobRecord): keyof typeof relevanceRank {
  if (job.effectiveRelevanceStatus === "pending") {
    return "pending";
  }
  if (job.effectiveRelevanceStatus === "failed") {
    return "failed";
  }
  if (job.effectiveRelevanceStatus === "unreviewed") {
    return "unreviewed";
  }
  if (job.effectiveRelevanceLabel === "relevant") {
    return "relevant";
  }
  if (job.effectiveRelevanceLabel === "borderline") {
    return "borderline";
  }
  return "irrelevant";
}

export function getRelevanceFlagStatus(job: JobRecord): string {
  if (job.effectiveRelevanceStatus === "pending") {
    return "Pending AI review";
  }
  if (job.effectiveRelevanceStatus === "failed") {
    return "AI failed";
  }
  if (job.effectiveRelevanceStatus === "unreviewed") {
    return "Unreviewed";
  }
  if (job.effectiveRelevanceLabel === "relevant") {
    return "Relevant";
  }
  if (job.effectiveRelevanceLabel === "borderline") {
    return "Borderline";
  }
  return "Irrelevant";
}

export function getRelevanceExplanation(job: JobRecord): string {
  if (job.effectiveRelevanceExplanation?.trim()) {
    return job.effectiveRelevanceExplanation.trim();
  }
  if (job.effectiveRelevanceStatus === "pending") {
    return "Pending AI review";
  }
  if (job.effectiveRelevanceStatus === "failed") {
    return "AI classification failed";
  }
  if (job.effectiveRelevanceStatus === "unreviewed") {
    return "Not sent for AI review";
  }
  return "No explanation returned";
}

export function getRelevanceExplanationPreview(job: JobRecord, maxLength = EXPLANATION_PREVIEW_LENGTH): {
  text: string;
  isTruncated: boolean;
} {
  const explanation = getRelevanceExplanation(job);
  if (explanation.length <= maxLength) {
    return {
      text: explanation,
      isTruncated: false
    };
  }

  return {
    text: `${explanation.slice(0, maxLength).trimEnd()}\u2026`,
    isTruncated: true
  };
}

function normalizeFilterValue(value: string): string {
  return value.trim().toLowerCase();
}

export function getJobFilterValues(job: JobRecord, field: FilterableJobField): string[] {
  switch (field) {
    case "company":
      return [job.company || "Unknown"];
    case "city":
      return [getJobCity(job) || "Unknown"];
    case "province":
      return [getJobProvince(job) || "Unknown"];
    case "relevance":
      return [getRelevanceFlagStatus(job)];
    case "searches":
      return job.matchingSearchProfiles.length ? job.matchingSearchProfiles : ["Unknown"];
    case "runLocations":
      return job.matchingRunLocations.length ? job.matchingRunLocations : ["Any"];
  }
}

export function countActiveColumnFilters(filters: ActiveColumnFilters): number {
  return filterableJobFields.reduce((count, field) => count + (filters[field]?.length ?? 0), 0);
}

export function applyColumnFilters(jobs: JobRecord[], filters: ActiveColumnFilters): JobRecord[] {
  return jobs.filter((job) =>
    filterableJobFields.every((field) => {
      const selectedValues = filters[field] ?? [];
      if (!selectedValues.length) {
        return true;
      }

      const normalizedSelections = new Set(selectedValues.map(normalizeFilterValue));
      return getJobFilterValues(job, field).some((value) => normalizedSelections.has(normalizeFilterValue(value)));
    }),
  );
}

export function getDistinctFilterOptions(
  jobs: JobRecord[],
  filters: ActiveColumnFilters,
  targetField: FilterableJobField,
): FilterOption[] {
  const otherFilters: ActiveColumnFilters = { ...filters };
  delete otherFilters[targetField];
  const baseRows = applyColumnFilters(jobs, otherFilters);
  const counts = new Map<string, { value: string; count: number }>();

  for (const job of baseRows) {
    for (const value of getJobFilterValues(job, targetField)) {
      const key = normalizeFilterValue(value);
      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, { value, count: 1 });
      }
    }
  }

  for (const selected of filters[targetField] ?? []) {
    const key = normalizeFilterValue(selected);
    if (!counts.has(key)) {
      counts.set(key, { value: selected, count: 0 });
    }
  }

  return [...counts.values()]
    .sort((a, b) => compareText(a.value, b.value))
    .map((entry) => ({
      value: entry.value,
      count: entry.count,
      selected: (filters[targetField] ?? []).some((selected) => normalizeFilterValue(selected) === normalizeFilterValue(entry.value))
    }));
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
    case "city":
      return compareText(getJobCity(a), getJobCity(b));
    case "province":
      return compareText(getJobProvince(a), getJobProvince(b));
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
