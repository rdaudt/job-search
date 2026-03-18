import { describe, expect, it } from "vitest";
import { resolveRunTargetIdFromUrl } from "../src/extension/profile-matching.js";

const runTargets = [
  {
    id: "run-frontend-vancouver",
    keywords: "frontend engineer react typescript",
    location: "Vancouver, BC",
    remote: true
  },
  {
    id: "run-backend-seattle",
    keywords: "backend engineer node",
    location: "Seattle, WA",
    remote: false
  }
];

describe("resolveRunTargetIdFromUrl", () => {
  it("matches a run target from Indeed query parameters", () => {
    const url =
      "https://www.indeed.com/jobs?q=frontend+engineer+react+typescript+remote&l=Vancouver%2C+BC";
    expect(resolveRunTargetIdFromUrl(url, runTargets)).toBe("run-frontend-vancouver");
  });

  it("falls back to the only launched run target", () => {
    const url = "https://www.indeed.com/jobs?q=something-else";
    expect(resolveRunTargetIdFromUrl(url, [runTargets[0]])).toBe("run-frontend-vancouver");
  });

  it("returns null when multiple profiles do not match", () => {
    const url = "https://www.indeed.com/jobs?q=fullstack+developer&l=Toronto%2C+ON";
    expect(resolveRunTargetIdFromUrl(url, runTargets)).toBeNull();
  });
});
