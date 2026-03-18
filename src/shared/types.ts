import { z } from "zod";

export const statusValues = ["new", "reviewed", "saved", "ignored"] as const;
export type JobStatus = (typeof statusValues)[number];
export const runTargetStatusValues = ["pending", "capturing", "completed", "failed"] as const;
export type RunTargetStatus = (typeof runTargetStatusValues)[number];

export const searchProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  keywords: z.string().min(1),
  location: z.string().default(""),
  remote: z.boolean().default(false)
});

export type SearchProfile = z.infer<typeof searchProfileSchema>;

export const captureListingSchema = z.object({
  sourceJobId: z.string().trim().optional(),
  url: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  title: z.string().min(1),
  company: z.string().default(""),
  location: z.string().default(""),
  summary: z.string().optional()
});

export type CaptureListing = z.infer<typeof captureListingSchema>;

export const capturePayloadSchema = z.object({
  source: z.literal("indeed"),
  runTargetId: z.string().min(1),
  pageUrl: z.string().url(),
  pageNumber: z.number().int().min(1).default(1),
  listings: z.array(captureListingSchema).min(1)
});

export type CapturePayload = z.infer<typeof capturePayloadSchema>;

export type RunRecord = {
  id: number;
  startedAt: string;
  searchCount: number;
  maxPages: number;
};

export type RunTarget = {
  id: string;
  runId: number;
  searchProfileId: string;
  searchProfileName: string;
  keywords: string;
  remote: boolean;
  location: string;
  maxPages: number;
  pagesCaptured: number;
  status: RunTargetStatus;
  stopReason: string | null;
  lastPageNumber: number | null;
  lastPageUrl: string | null;
  updatedAt: string;
};

export const runTargetStateUpdateSchema = z.object({
  status: z.enum(runTargetStatusValues),
  stopReason: z.string().trim().min(1).optional(),
  pageNumber: z.number().int().min(1).optional(),
  pageUrl: z.string().url().optional()
});

export type RunTargetStateUpdate = z.infer<typeof runTargetStateUpdateSchema>;

export type JobRecord = {
  id: number;
  source: string;
  sourceJobId: string | null;
  dedupeKey: string;
  normalizedUrl: string;
  isLinkable: boolean;
  title: string;
  company: string;
  location: string;
  summary: string | null;
  firstCapturedAt: string;
  lastSeenAt: string;
  status: JobStatus;
  matchingSearchProfiles: string[];
  matchingRunLocations: string[];
};

export type PersistedSearchProfile = SearchProfile & {
  createdAt: string;
  updatedAt: string;
};

export type JobCsvRow = {
  title: string;
  company: string;
  location: string;
  source: string;
  sourceUrl: string;
  searchProfiles: string;
  runLocations: string;
  firstCapturedAt: string;
  lastSeenAt: string;
  status: JobStatus;
};

export type SourceAdapter = {
  buildSearchUrl(runTarget: RunTarget): string;
  normalizeListingKey(listing: CaptureListing): {
    sourceJobId: string | null;
    normalizedUrl: string;
    dedupeKey: string;
    isLinkable: boolean;
  };
  mapCaptureToJobRecord(listing: CaptureListing): {
    source: string;
    sourceJobId: string | null;
    normalizedUrl: string;
    dedupeKey: string;
    isLinkable: boolean;
    title: string;
    company: string;
    location: string;
    summary: string | null;
  };
};

export type AppSummary = {
  searches: PersistedSearchProfile[];
  jobs: JobRecord[];
  runs: RunRecord[];
  latestRunTargets: RunTarget[];
};
