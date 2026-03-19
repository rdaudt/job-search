import { describe, expect, it } from "vitest";
import { aggregateJobRelevance, buildRelevanceFingerprint } from "../src/server/relevance/utils.js";

describe("relevance utils", () => {
  it("builds a stable fingerprint from normalized inputs", () => {
    const a = buildRelevanceFingerprint({
      searchProfileName: "Fitness Coach",
      keywords: "fitness coach",
      remote: false,
      title: "Fitness Coach ",
      company: " Acme ",
      location: "Vancouver, BC",
      summary: "Help members train"
    });
    const b = buildRelevanceFingerprint({
      searchProfileName: "fitness coach",
      keywords: "fitness   coach",
      remote: false,
      title: "fitness coach",
      company: "acme",
      location: "Vancouver,   BC",
      summary: " Help members train "
    });

    expect(a).toBe(b);
  });

  it("prefers relevant over borderline and pending over irrelevant", () => {
    expect(
      aggregateJobRelevance([
        { status: "complete", relevance: "irrelevant", confidence: 0.9, reason: "Wrong domain" },
        { status: "pending", relevance: null, confidence: null, reason: null }
      ]),
    ).toEqual({
      relevanceStatus: "pending",
      relevanceLabel: null,
      relevanceReason: null
    });

    expect(
      aggregateJobRelevance([
        { status: "complete", relevance: "borderline", confidence: 0.65, reason: "Close fit" },
        { status: "complete", relevance: "relevant", confidence: 0.91, reason: "Strong match" }
      ]),
    ).toEqual({
      relevanceStatus: "complete",
      relevanceLabel: "relevant",
      relevanceReason: "Strong match"
    });
  });
});
