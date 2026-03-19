import { createHash } from "node:crypto";
import type { RelevanceLabel, RelevanceStatus } from "../../shared/types.js";

export const OPENAI_RELEVANCE_PROMPT_VERSION = "relevance-v1";

export type RelevanceJobInput = {
  searchProfileName: string;
  keywords: string;
  remote: boolean;
  globalGuidance: string;
  jobOverrideNote: string | null;
  title: string;
  company: string;
  location: string;
  summary: string | null;
};

export type RelevanceResult = {
  relevance: RelevanceLabel;
  confidence: number;
  reason: string;
  signals: string[];
  disqualifiers: string[];
};

export type AggregatedJobRelevance = {
  relevanceStatus: RelevanceStatus;
  relevanceLabel: RelevanceLabel | null;
  relevanceReason: string | null;
};

export type EffectiveJobRelevance = {
  effectiveRelevanceStatus: RelevanceStatus;
  effectiveRelevanceLabel: RelevanceLabel | null;
  effectiveRelevanceExplanation: string | null;
  hasUserOverride: boolean;
  userOverrideLabel: RelevanceLabel | null;
  userOverrideNote: string | null;
};

type StoredRelevance = {
  status: Exclude<RelevanceStatus, "unreviewed">;
  relevance: RelevanceLabel | null;
  confidence: number | null;
  reason: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildRelevanceFingerprint(input: RelevanceJobInput): string {
  const normalized = {
    searchProfileName: normalizeText(input.searchProfileName),
    keywords: normalizeText(input.keywords),
    remote: input.remote ? "true" : "false",
    globalGuidance: normalizeText(input.globalGuidance),
    jobOverrideNote: normalizeText(input.jobOverrideNote),
    title: normalizeText(input.title),
    company: normalizeText(input.company),
    location: normalizeText(input.location),
    summary: normalizeText(input.summary)
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function aggregateJobRelevance(rows: StoredRelevance[]): AggregatedJobRelevance {
  if (!rows.length) {
    return {
      relevanceStatus: "unreviewed",
      relevanceLabel: null,
      relevanceReason: null
    };
  }

  const bestRelevant = rows
    .filter((row) => row.status === "complete" && row.relevance === "relevant")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (bestRelevant) {
    return {
      relevanceStatus: "complete",
      relevanceLabel: "relevant",
      relevanceReason: bestRelevant.reason
    };
  }

  const bestBorderline = rows
    .filter((row) => row.status === "complete" && row.relevance === "borderline")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (bestBorderline) {
    return {
      relevanceStatus: "complete",
      relevanceLabel: "borderline",
      relevanceReason: bestBorderline.reason
    };
  }

  if (rows.some((row) => row.status === "pending")) {
    return {
      relevanceStatus: "pending",
      relevanceLabel: null,
      relevanceReason: null
    };
  }

  const bestIrrelevant = rows
    .filter((row) => row.status === "complete" && row.relevance === "irrelevant")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (bestIrrelevant) {
    return {
      relevanceStatus: "complete",
      relevanceLabel: "irrelevant",
      relevanceReason: bestIrrelevant.reason
    };
  }

  return {
    relevanceStatus: "failed",
    relevanceLabel: null,
    relevanceReason: null
  };
}

export function resolveEffectiveJobRelevance(
  aggregated: AggregatedJobRelevance,
  override:
    | {
        relevance: RelevanceLabel;
        note: string;
      }
    | undefined,
): EffectiveJobRelevance {
  if (override) {
    return {
      effectiveRelevanceStatus: "complete",
      effectiveRelevanceLabel: override.relevance,
      effectiveRelevanceExplanation: override.note,
      hasUserOverride: true,
      userOverrideLabel: override.relevance,
      userOverrideNote: override.note
    };
  }

  return {
    effectiveRelevanceStatus: aggregated.relevanceStatus,
    effectiveRelevanceLabel: aggregated.relevanceLabel,
    effectiveRelevanceExplanation: aggregated.relevanceReason,
    hasUserOverride: false,
    userOverrideLabel: null,
    userOverrideNote: null
  };
}
