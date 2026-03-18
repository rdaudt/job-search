type MatchableRunTarget = {
  id: string;
  keywords: string;
  remote: boolean;
  location: string;
};

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function expectedQuery(runTarget: Pick<MatchableRunTarget, "keywords" | "remote">): string {
  return normalizeValue(runTarget.remote ? `${runTarget.keywords} remote` : runTarget.keywords);
}

function expectedLocation(runTarget: Pick<MatchableRunTarget, "location">): string {
  return normalizeValue(runTarget.location ?? "");
}

export function resolveRunTargetIdFromUrl(
  pageUrl: string,
  runTargets: MatchableRunTarget[],
): string | null {
  if (runTargets.length === 1) {
    return runTargets[0].id;
  }

  const url = new URL(pageUrl);
  const queryValue = normalizeValue(url.searchParams.get("q") ?? "");
  const locationValue = normalizeValue(url.searchParams.get("l") ?? "");

  if (!queryValue) {
    return null;
  }

  const exactMatches = runTargets.filter(
    (runTarget) =>
      expectedQuery(runTarget) === queryValue && expectedLocation(runTarget) === locationValue,
  );
  if (exactMatches.length === 1) {
    return exactMatches[0].id;
  }

  if (!locationValue) {
    const queryOnlyMatches = runTargets.filter((runTarget) => expectedQuery(runTarget) === queryValue);
    if (queryOnlyMatches.length === 1) {
      return queryOnlyMatches[0].id;
    }
  }

  return null;
}
