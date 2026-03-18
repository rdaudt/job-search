import { describe, expect, it } from "vitest";
import { resolveSearchProfileIdFromUrl } from "../src/extension/profile-matching.js";

const profiles = [
  {
    id: "frontend-remote",
    name: "Frontend Remote",
    keywords: "frontend engineer react typescript",
    location: "Vancouver, BC",
    remote: true
  },
  {
    id: "backend-local",
    name: "Backend Local",
    keywords: "backend engineer node",
    location: "Seattle, WA",
    remote: false
  }
];

describe("resolveSearchProfileIdFromUrl", () => {
  it("matches a profile from Indeed query parameters", () => {
    const url =
      "https://www.indeed.com/jobs?q=frontend+engineer+react+typescript+remote&l=Vancouver%2C+BC";
    expect(resolveSearchProfileIdFromUrl(url, profiles)).toBe("frontend-remote");
  });

  it("falls back to the only imported profile", () => {
    const url = "https://www.indeed.com/jobs?q=something-else";
    expect(resolveSearchProfileIdFromUrl(url, [profiles[0]])).toBe("frontend-remote");
  });

  it("returns null when multiple profiles do not match", () => {
    const url = "https://www.indeed.com/jobs?q=fullstack+developer&l=Toronto%2C+ON";
    expect(resolveSearchProfileIdFromUrl(url, profiles)).toBeNull();
  });
});
