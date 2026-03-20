import { z } from "zod";

export const statusValues = ["new", "reviewed", "saved", "ignored"] as const;
export type JobStatus = (typeof statusValues)[number];
export const relevanceStatusValues = ["unreviewed", "pending", "complete", "failed"] as const;
export type RelevanceStatus = (typeof relevanceStatusValues)[number];
export const relevanceLabelValues = ["relevant", "borderline", "irrelevant"] as const;
export type RelevanceLabel = (typeof relevanceLabelValues)[number];
export const runTargetStatusValues = ["pending", "capturing", "completed", "failed"] as const;
export type RunTargetStatus = (typeof runTargetStatusValues)[number];
export const runModeValues = ["fixed", "auto"] as const;
export type RunMode = (typeof runModeValues)[number];
export const runRetentionModeValues = ["reset", "cumulative"] as const;
export type RunRetentionMode = (typeof runRetentionModeValues)[number];
export const DEFAULT_FIXED_MAX_PAGES = 3;
export const DEFAULT_AUTO_ZERO_NEW_JOBS_THRESHOLD = 2;
export const DEFAULT_EMERGENCY_MAX_PAGES = 50;
export const DEFAULT_SEARCH_LAUNCH_DELAY_MS = 20_000;
export const DEFAULT_SEARCH_LAUNCH_JITTER_MS = 20_000;
export const DEFAULT_PAGE_DELAY_MS = 8_000;
export const DEFAULT_PAGE_DELAY_JITTER_MS = 12_000;

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
  retentionMode: RunRetentionMode;
  runMode: RunMode;
  maxPages: number;
  zeroNewJobsThreshold: number;
  emergencyMaxPages: number;
  searchLaunchDelayMs: number;
  searchLaunchJitterMs: number;
  pageDelayMs: number;
  pageDelayJitterMs: number;
};

export type RunTarget = {
  id: string;
  runId: number;
  searchProfileId: string;
  searchProfileName: string;
  keywords: string;
  remote: boolean;
  location: string;
  runMode: RunMode;
  maxPages: number;
  zeroNewJobsThreshold: number;
  emergencyMaxPages: number;
  searchLaunchDelayMs: number;
  searchLaunchJitterMs: number;
  pageDelayMs: number;
  pageDelayJitterMs: number;
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

export const runRequestSchema = z.object({
  locations: z.array(z.string()).optional().default([]),
  retentionMode: z.enum(runRetentionModeValues).optional().default("cumulative"),
  mode: z.enum(runModeValues).optional().default("fixed"),
  maxPages: z.number().int().min(1).optional().default(DEFAULT_FIXED_MAX_PAGES),
  zeroNewJobsThreshold: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(DEFAULT_AUTO_ZERO_NEW_JOBS_THRESHOLD),
  searchLaunchDelayMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(DEFAULT_SEARCH_LAUNCH_DELAY_MS),
  searchLaunchJitterMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(DEFAULT_SEARCH_LAUNCH_JITTER_MS),
  pageDelayMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(DEFAULT_PAGE_DELAY_MS),
  pageDelayJitterMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(DEFAULT_PAGE_DELAY_JITTER_MS)
});

export type RunRequest = z.infer<typeof runRequestSchema>;

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
  locationCity: string;
  locationProvince: string;
  summary: string | null;
  firstCapturedAt: string;
  lastSeenAt: string;
  status: JobStatus;
  relevanceStatus: RelevanceStatus;
  relevanceLabel: RelevanceLabel | null;
  relevanceReason: string | null;
  effectiveRelevanceStatus: RelevanceStatus;
  effectiveRelevanceLabel: RelevanceLabel | null;
  effectiveRelevanceExplanation: string | null;
  hasUserOverride: boolean;
  userOverrideLabel: RelevanceLabel | null;
  userOverrideNote: string | null;
  matchingSearchProfiles: string[];
  matchingRunLocations: string[];
};

export type JobRelevanceOverride = {
  jobId: number;
  relevance: RelevanceLabel;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  relevanceGuidance: string;
  updatedAt: string | null;
};

export type AiReviewSummary = {
  pendingCount: number;
  completeCount: number;
  failedCount: number;
  totalCount: number;
  status: "idle" | "in_progress" | "completed" | "completed_with_failures";
  lastUpdatedAt: string | null;
};

export const guidanceUpdateSchema = z.object({
  guidance: z.string().max(4000).default("")
});

export type GuidanceUpdate = z.infer<typeof guidanceUpdateSchema>;

export const jobRelevanceOverrideSchema = z.object({
  relevance: z.enum(relevanceLabelValues),
  note: z.string().trim().min(1).max(1000)
});

export type JobRelevanceOverrideInput = z.infer<typeof jobRelevanceOverrideSchema>;

export type JobProfileRelevance = {
  jobId: number;
  searchProfileId: string;
  status: Exclude<RelevanceStatus, "unreviewed">;
  relevance: RelevanceLabel | null;
  confidence: number | null;
  reason: string | null;
  signals: string[];
  disqualifiers: string[];
  model: string | null;
  promptVersion: string | null;
  classifiedAt: string | null;
  sourceFingerprint: string;
  updatedAt: string;
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
  settings: AppSettings;
  aiReview: AiReviewSummary;
  searches: PersistedSearchProfile[];
  jobs: JobRecord[];
  runs: RunRecord[];
  latestRunTargets: RunTarget[];
};
