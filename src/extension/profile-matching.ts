import type { SearchProfile } from "../shared/types.js";

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function expectedQuery(profile: SearchProfile): string {
  return normalizeValue(profile.remote ? `${profile.keywords} remote` : profile.keywords);
}

function expectedLocation(profile: SearchProfile): string {
  return normalizeValue(profile.location ?? "");
}

export function resolveSearchProfileIdFromUrl(
  pageUrl: string,
  profiles: SearchProfile[],
): string | null {
  if (profiles.length === 1) {
    return profiles[0].id;
  }

  const url = new URL(pageUrl);
  const queryValue = normalizeValue(url.searchParams.get("q") ?? "");
  const locationValue = normalizeValue(url.searchParams.get("l") ?? "");

  if (!queryValue) {
    return null;
  }

  const exactMatches = profiles.filter(
    (profile) =>
      expectedQuery(profile) === queryValue && expectedLocation(profile) === locationValue,
  );
  if (exactMatches.length === 1) {
    return exactMatches[0].id;
  }

  if (!locationValue) {
    const queryOnlyMatches = profiles.filter((profile) => expectedQuery(profile) === queryValue);
    if (queryOnlyMatches.length === 1) {
      return queryOnlyMatches[0].id;
    }
  }

  return null;
}
