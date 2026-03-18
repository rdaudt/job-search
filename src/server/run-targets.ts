import { randomUUID } from "node:crypto";
import type { PersistedSearchProfile } from "../shared/types.js";

type RunTargetTemplate = {
  id: string;
  searchProfileId: string;
  searchProfileName: string;
  keywords: string;
  remote: boolean;
  location: string;
};

function normalizeLocation(location: string): string {
  return location.trim().replace(/\s+/g, " ");
}

export function normalizeRunLocations(locations: string[]): string[] {
  const deduped = new Map<string, string>();
  for (const value of locations) {
    const normalized = normalizeLocation(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }
  return [...deduped.values()];
}

export function buildRunTargetTemplates(
  profiles: PersistedSearchProfile[],
  requestedLocations: string[],
): RunTargetTemplate[] {
  const normalizedLocations = normalizeRunLocations(requestedLocations);
  const templates: RunTargetTemplate[] = [];

  for (const profile of profiles) {
    const locations = normalizedLocations.length
      ? normalizedLocations
      : [normalizeLocation(profile.location || "")];

    for (const location of locations) {
      templates.push({
        id: randomUUID(),
        searchProfileId: profile.id,
        searchProfileName: profile.name,
        keywords: profile.keywords,
        remote: profile.remote,
        location
      });
    }
  }

  return templates;
}
