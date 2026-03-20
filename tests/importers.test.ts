import { describe, expect, it } from "vitest";
import {
  parseSearchProfilesFile,
  parseSearchProfilesFromCsv,
  parseSearchProfilesFromJson
} from "../src/server/importers.js";

describe("search importers", () => {
  it("parses JSON imports without id and name", () => {
    const profiles = parseSearchProfilesFromJson(`
      [
        {"keywords":"react","location":"Vancouver, BC","remote":true}
      ]
    `);

    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("react-remote-vancouver-bc");
    expect(profiles[0].name).toBe("react | Remote | Vancouver, BC");
    expect(profiles[0].remote).toBe(true);
  });

  it("parses CSV imports without id and name columns", () => {
    const profiles = parseSearchProfilesFromCsv('keywords,location,remote\nreact,"Vancouver, BC",yes');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("react-remote-vancouver-bc");
    expect(profiles[0].name).toBe("react | Remote | Vancouver, BC");
    expect(profiles[0].remote).toBe(true);
  });

  it("keeps backward compatibility with explicit id and name", () => {
    const profiles = parseSearchProfilesFromJson(`
      [
        {"id":"one","name":"One","keywords":"react","location":"Vancouver, BC","remote":true}
      ]
    `);

    expect(profiles[0].id).toBe("one");
    expect(profiles[0].name).toBe("One");
  });

  it("makes duplicate generated ids unique", () => {
    const profiles = parseSearchProfilesFromJson(`
      [
        {"keywords":"react","location":"Vancouver, BC","remote":false},
        {"keywords":"react","location":"Vancouver, BC","remote":false}
      ]
    `);

    expect(profiles.map((profile) => profile.id)).toEqual([
      "react-vancouver-bc",
      "react-vancouver-bc-2"
    ]);
  });

  it("rejects non-Canadian JSON locations", () => {
    expect(() =>
      parseSearchProfilesFromJson(`
        [
          {"keywords":"react","location":"Seattle, WA","remote":false}
        ]
      `),
    ).toThrow("Canadian location");
  });

  it("rejects non-Canadian CSV locations", () => {
    expect(() =>
      parseSearchProfilesFromCsv('keywords,location,remote\nreact,"Seattle, WA",false'),
    ).toThrow("Canadian location");
  });

  it("rejects unsupported file types", () => {
    expect(() => parseSearchProfilesFile("searches.txt", "x")).toThrow(".json and .csv");
  });
});
