import { describe, expect, it } from "vitest";
import {
  parseSearchProfilesFile,
  parseSearchProfilesFromCsv,
  parseSearchProfilesFromJson
} from "../src/server/importers.js";

describe("search importers", () => {
  it("parses JSON imports", () => {
    const profiles = parseSearchProfilesFromJson(`
      [
        {"id":"one","name":"One","keywords":"react","location":"Remote","remote":true}
      ]
    `);

    expect(profiles).toHaveLength(1);
    expect(profiles[0].remote).toBe(true);
  });

  it("parses CSV imports", () => {
    const profiles = parseSearchProfilesFromCsv("id,name,keywords,location,remote\none,One,react,Remote,yes");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].remote).toBe(true);
  });

  it("rejects unsupported file types", () => {
    expect(() => parseSearchProfilesFile("searches.txt", "x")).toThrow(".json and .csv");
  });
});
