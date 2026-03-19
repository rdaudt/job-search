import { parse } from "csv-parse/sync";
import { searchProfileSchema, type SearchProfile } from "../shared/types.js";
import { assertCanadianLocation } from "../shared/location-utils.js";

function normalizeBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

export function parseSearchProfilesFromJson(raw: string): SearchProfile[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON import must be an array of search profiles.");
  }
  return parsed.map((entry, index) => {
    const profile = searchProfileSchema.parse(entry, {
      path: [index]
    });
    assertCanadianLocation(profile.location, `Location for search '${profile.name}'`);
    return profile;
  });
}

export function parseSearchProfilesFromCsv(raw: string): SearchProfile[] {
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];

  return rows.map((row, index) => {
    const profile = searchProfileSchema.parse(
      {
        id: row.id,
        name: row.name,
        keywords: row.keywords,
        location: row.location ?? "",
        remote: row.remote ? normalizeBoolean(row.remote) : false
      },
      {
        path: [index]
      },
    );
    assertCanadianLocation(profile.location, `Location for search '${profile.name}'`);
    return profile;
  });
}

export function parseSearchProfilesFile(filename: string, content: string): SearchProfile[] {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".json")) {
    return parseSearchProfilesFromJson(content);
  }
  if (lowerName.endsWith(".csv")) {
    return parseSearchProfilesFromCsv(content);
  }
  throw new Error("Only .json and .csv files are supported.");
}
