import { describe, expect, it } from "vitest";
import { buildRunTargetTemplates, normalizeRunLocations } from "../src/server/run-targets.js";

describe("run target helpers", () => {
  it("normalizes and deduplicates multiline locations", () => {
    expect(
      normalizeRunLocations([" Vancouver, BC ", "Burnaby, BC", "vancouver, bc", "", "Burnaby, BC"]),
    ).toEqual(["Vancouver, BC", "Burnaby, BC"]);
  });

  it("cross-products profiles with requested run locations", () => {
    const profiles = [
      {
        id: "frontend",
        name: "Frontend",
        keywords: "frontend engineer",
        location: "Vancouver, BC",
        remote: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "backend",
        name: "Backend",
        keywords: "backend engineer",
        location: "Seattle, WA",
        remote: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ];

    const targets = buildRunTargetTemplates(profiles, ["Vancouver, BC", "Burnaby, BC"]);
    expect(targets).toHaveLength(4);
    expect(targets.filter((target) => target.searchProfileId === "frontend")).toHaveLength(2);
    expect(targets.filter((target) => target.searchProfileId === "backend")).toHaveLength(2);
  });

  it("falls back to the imported profile location when no run locations are provided", () => {
    const [target] = buildRunTargetTemplates(
      [
        {
          id: "frontend",
          name: "Frontend",
          keywords: "frontend engineer",
          location: "Vancouver, BC",
          remote: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      [],
    );

    expect(target.location).toBe("Vancouver, BC");
  });
});
