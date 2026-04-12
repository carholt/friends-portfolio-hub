export function cleanName(name: string) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 50);
}

export function buildAssetIdentifier(isin?: string | null, name?: string | null) {
  const normalizedIsin = String(isin || "").trim().toUpperCase();
  if (normalizedIsin) {
    return `ISIN:${normalizedIsin}`;
  }

  const fallback = cleanName(String(name || "").trim()) || "UNKNOWN";
  return `NAME:${fallback}`;
}
