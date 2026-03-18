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

type RegionInfo = {
  code: string;
  countryCode: "ca" | "us";
  aliases: string[];
};

type ParsedRunLocation = {
  raw: string;
  normalized: string;
  city: string;
  region: string;
  regionCode: string | null;
  countryCode: "ca" | "us" | null;
};

const regionInfos: RegionInfo[] = [
  { code: "bc", countryCode: "ca", aliases: ["bc", "british columbia"] },
  { code: "ab", countryCode: "ca", aliases: ["ab", "alberta"] },
  { code: "sk", countryCode: "ca", aliases: ["sk", "saskatchewan"] },
  { code: "mb", countryCode: "ca", aliases: ["mb", "manitoba"] },
  { code: "on", countryCode: "ca", aliases: ["on", "ontario"] },
  { code: "qc", countryCode: "ca", aliases: ["qc", "quebec", "québec"] },
  { code: "nb", countryCode: "ca", aliases: ["nb", "new brunswick"] },
  { code: "ns", countryCode: "ca", aliases: ["ns", "nova scotia"] },
  { code: "pe", countryCode: "ca", aliases: ["pe", "pei", "prince edward island"] },
  { code: "nl", countryCode: "ca", aliases: ["nl", "newfoundland and labrador"] },
  { code: "yt", countryCode: "ca", aliases: ["yt", "yukon"] },
  { code: "nt", countryCode: "ca", aliases: ["nt", "northwest territories"] },
  { code: "nu", countryCode: "ca", aliases: ["nu", "nunavut"] },
  { code: "al", countryCode: "us", aliases: ["al", "alabama"] },
  { code: "ak", countryCode: "us", aliases: ["ak", "alaska"] },
  { code: "az", countryCode: "us", aliases: ["az", "arizona"] },
  { code: "ar", countryCode: "us", aliases: ["ar", "arkansas"] },
  { code: "ca", countryCode: "us", aliases: ["ca", "california"] },
  { code: "co", countryCode: "us", aliases: ["co", "colorado"] },
  { code: "ct", countryCode: "us", aliases: ["ct", "connecticut"] },
  { code: "de", countryCode: "us", aliases: ["de", "delaware"] },
  { code: "fl", countryCode: "us", aliases: ["fl", "florida"] },
  { code: "ga", countryCode: "us", aliases: ["ga", "georgia"] },
  { code: "hi", countryCode: "us", aliases: ["hi", "hawaii"] },
  { code: "id", countryCode: "us", aliases: ["id", "idaho"] },
  { code: "il", countryCode: "us", aliases: ["il", "illinois"] },
  { code: "in", countryCode: "us", aliases: ["in", "indiana"] },
  { code: "ia", countryCode: "us", aliases: ["ia", "iowa"] },
  { code: "ks", countryCode: "us", aliases: ["ks", "kansas"] },
  { code: "ky", countryCode: "us", aliases: ["ky", "kentucky"] },
  { code: "la", countryCode: "us", aliases: ["la", "louisiana"] },
  { code: "me", countryCode: "us", aliases: ["me", "maine"] },
  { code: "md", countryCode: "us", aliases: ["md", "maryland"] },
  { code: "ma", countryCode: "us", aliases: ["ma", "massachusetts"] },
  { code: "mi", countryCode: "us", aliases: ["mi", "michigan"] },
  { code: "mn", countryCode: "us", aliases: ["mn", "minnesota"] },
  { code: "ms", countryCode: "us", aliases: ["ms", "mississippi"] },
  { code: "mo", countryCode: "us", aliases: ["mo", "missouri"] },
  { code: "mt", countryCode: "us", aliases: ["mt", "montana"] },
  { code: "ne", countryCode: "us", aliases: ["ne", "nebraska"] },
  { code: "nv", countryCode: "us", aliases: ["nv", "nevada"] },
  { code: "nh", countryCode: "us", aliases: ["nh", "new hampshire"] },
  { code: "nj", countryCode: "us", aliases: ["nj", "new jersey"] },
  { code: "nm", countryCode: "us", aliases: ["nm", "new mexico"] },
  { code: "ny", countryCode: "us", aliases: ["ny", "new york"] },
  { code: "nc", countryCode: "us", aliases: ["nc", "north carolina"] },
  { code: "nd", countryCode: "us", aliases: ["nd", "north dakota"] },
  { code: "oh", countryCode: "us", aliases: ["oh", "ohio"] },
  { code: "ok", countryCode: "us", aliases: ["ok", "oklahoma"] },
  { code: "or", countryCode: "us", aliases: ["or", "oregon"] },
  { code: "pa", countryCode: "us", aliases: ["pa", "pennsylvania"] },
  { code: "ri", countryCode: "us", aliases: ["ri", "rhode island"] },
  { code: "sc", countryCode: "us", aliases: ["sc", "south carolina"] },
  { code: "sd", countryCode: "us", aliases: ["sd", "south dakota"] },
  { code: "tn", countryCode: "us", aliases: ["tn", "tennessee"] },
  { code: "tx", countryCode: "us", aliases: ["tx", "texas"] },
  { code: "ut", countryCode: "us", aliases: ["ut", "utah"] },
  { code: "vt", countryCode: "us", aliases: ["vt", "vermont"] },
  { code: "va", countryCode: "us", aliases: ["va", "virginia"] },
  { code: "wa", countryCode: "us", aliases: ["wa", "washington"] },
  { code: "wv", countryCode: "us", aliases: ["wv", "west virginia"] },
  { code: "wi", countryCode: "us", aliases: ["wi", "wisconsin"] },
  { code: "wy", countryCode: "us", aliases: ["wy", "wyoming"] },
  { code: "dc", countryCode: "us", aliases: ["dc", "district of columbia", "washington dc"] }
];

const regionLookup = new Map<string, RegionInfo>();
for (const regionInfo of regionInfos) {
  for (const alias of regionInfo.aliases) {
    regionLookup.set(alias, regionInfo);
  }
}

function resolveRegionInfo(value: string): RegionInfo | null {
  const normalizedValue = normalizeText(value).replace(/\./g, "");
  if (!normalizedValue) {
    return null;
  }

  const directMatch = regionLookup.get(normalizedValue);
  if (directMatch) {
    return directMatch;
  }

  for (const regionInfo of regionInfos) {
    if (
      regionInfo.aliases.some((alias) =>
        new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(normalizedValue),
      )
    ) {
      return regionInfo;
    }
  }

  return null;
}

export function parseRunLocation(rawLocation: string): ParsedRunLocation {
  const normalized = normalizeText(rawLocation);
  const parts = rawLocation
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const city = titleCase(parts[0] ?? "");
  const region = (parts[1] ?? "").trim();
  const regionInfo = resolveRegionInfo(region) ?? resolveRegionInfo(normalized);

  let countryCode: "ca" | "us" | null = regionInfo?.countryCode ?? null;
  if (!countryCode && normalizeText(parts.at(-1) ?? "") === "canada") {
    countryCode = "ca";
  } else if (
    !countryCode &&
    ["usa", "united states", "united states of america"].includes(normalizeText(parts.at(-1) ?? ""))
  ) {
    countryCode = "us";
  }

  return {
    raw: rawLocation,
    normalized,
    city,
    region,
    regionCode: regionInfo?.code ?? null,
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

export function listingMatchesRunLocation(listingLocation: string, runLocation: string, allowRemote = false): boolean {
  const normalizedListing = normalizeText(listingLocation);
  if (!runLocation.trim()) {
    return true;
  }
  if (!normalizedListing) {
    return false;
  }

  const requested = parseRunLocation(runLocation);
  const listing = parseRunLocation(listingLocation);
  const isRemoteListing = /\bremote\b/.test(normalizedListing);

  if (requested.countryCode === "ca" && listing.countryCode === "us") {
    return false;
  }
  if (requested.countryCode === "us" && listing.countryCode === "ca") {
    return false;
  }

  if (allowRemote && isRemoteListing) {
    if (requested.regionCode && listing.regionCode && requested.regionCode !== listing.regionCode) {
      return false;
    }
    return true;
  }

  if (requested.regionCode && listing.regionCode && requested.regionCode !== listing.regionCode) {
    return false;
  }

  if (requested.city) {
    const requestedCity = normalizeText(requested.city);
    if (normalizedListing.includes(requestedCity)) {
      return true;
    }
  }

  if (requested.regionCode) {
    return listing.regionCode === requested.regionCode || normalizedListing.includes(normalizeText(requested.region));
  }

  return true;
}
