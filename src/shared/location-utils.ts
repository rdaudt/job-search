function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

type ParsedRunLocation = {
  raw: string;
  normalized: string;
  city: string;
  region: string;
  countryCode: "ca" | "us" | null;
};

const canadianRegionCodes = new Set(["bc", "ab", "sk", "mb", "on", "qc", "nb", "ns", "pe", "nl", "yt", "nt", "nu"]);
const usRegionCodes = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
  "dc"
]);

export function parseRunLocation(rawLocation: string): ParsedRunLocation {
  const normalized = normalizeText(rawLocation);
  const parts = rawLocation
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const city = titleCase(parts[0] ?? "");
  const region = (parts[1] ?? "").trim();
  const regionCode = normalizeText(region);

  let countryCode: "ca" | "us" | null = null;
  if (canadianRegionCodes.has(regionCode)) {
    countryCode = "ca";
  } else if (usRegionCodes.has(regionCode)) {
    countryCode = "us";
  } else if (normalizeText(parts.at(-1) ?? "") === "canada") {
    countryCode = "ca";
  } else if (
    ["usa", "united states", "united states of america"].includes(normalizeText(parts.at(-1) ?? ""))
  ) {
    countryCode = "us";
  }

  return {
    raw: rawLocation,
    normalized,
    city,
    region,
    countryCode
  };
}

export function selectIndeedHostForLocation(location: string): string {
  const parsed = parseRunLocation(location);
  if (parsed.countryCode === "ca") {
    return "ca.indeed.com";
  }
  return "www.indeed.com";
}

export function listingMatchesRunLocation(listingLocation: string, runLocation: string): boolean {
  const normalizedListing = normalizeText(listingLocation);
  if (!runLocation.trim()) {
    return true;
  }
  if (!normalizedListing) {
    return false;
  }

  const requested = parseRunLocation(runLocation);
  const listing = parseRunLocation(listingLocation);

  if (requested.countryCode === "ca" && listing.countryCode === "us") {
    return false;
  }
  if (requested.countryCode === "us" && listing.countryCode === "ca") {
    return false;
  }

  if (requested.region && listing.region) {
    const requestedRegion = normalizeText(requested.region);
    const listingRegion = normalizeText(listing.region);
    if (requestedRegion !== listingRegion) {
      return false;
    }
  }

  if (requested.city) {
    const requestedCity = normalizeText(requested.city);
    if (normalizedListing.includes(requestedCity)) {
      return true;
    }
  }

  if (requested.region) {
    return normalizedListing.includes(normalizeText(requested.region));
  }

  return true;
}
