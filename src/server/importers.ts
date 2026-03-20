import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { SearchProfile } from "../shared/types.js";
import { assertCanadianLocation } from "../shared/location-utils.js";

const importedSearchProfileSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  keywords: z.string().trim().min(1),
  location: z.string().default(""),
  remote: z.boolean().default(false)
});

type ImportedSearchProfile = z.infer<typeof importedSearchProfileSchema>;

function normalizeBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function generateSearchProfileName(profile: Pick<SearchProfile, "keywords" | "location" | "remote">): string {
  const parts = [profile.keywords];
  if (profile.remote) {
    parts.push("Remote");
  }
  if (profile.location) {
    parts.push(profile.location);
  }
  return parts.join(" | ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[_\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function finalizeImportedProfiles(entries: ImportedSearchProfile[]): SearchProfile[] {
  const usedIds = new Map<string, number>();

  return entries.map((entry, index) => {
    const keywords = normalizeText(entry.keywords);
    const location = normalizeText(entry.location ?? "");
    const remote = Boolean(entry.remote);
    const generatedName = generateSearchProfileName({ keywords, location, remote });
    const explicitName = entry.name ? normalizeText(entry.name) : "";
    const baseIdSource = entry.id ? normalizeText(entry.id) : generatedName || `search-${index + 1}`;
    const baseId = slugify(baseIdSource) || `search-${index + 1}`;
    const nextCount = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, nextCount);
    const id = nextCount === 1 ? baseId : `${baseId}-${nextCount}`;
    const name = explicitName || generatedName;

    assertCanadianLocation(location, `Location for search '${name}'`);

    return {
      id,
      name,
      keywords,
      location,
      remote
    };
  });
}

export function parseSearchProfilesFromJson(raw: string): SearchProfile[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON import must be an array of search profiles.");
  }
  return finalizeImportedProfiles(
    parsed.map((entry, index) =>
      importedSearchProfileSchema.parse(entry, {
        path: [index]
      }),
    ),
  );
}

export function parseSearchProfilesFromCsv(raw: string): SearchProfile[] {
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];

  return finalizeImportedProfiles(
    rows.map((row, index) =>
      importedSearchProfileSchema.parse(
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
      ),
    ),
  );
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
