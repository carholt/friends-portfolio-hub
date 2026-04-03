export type PurchaseRedirectValidationOptions = {
  appOrigin?: string | null;
  appAllowedOrigins?: string | null;
  appAllowedPurchasePathPrefixes?: string | null;
};

const ALLOWED_PURCHASE_STATUSES = new Set(["success", "cancel"]);

function parseCsvList(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getAllowedOrigins(appOrigin?: string | null, appAllowedOrigins?: string | null): string[] {
  const configuredOrigins = parseCsvList(appAllowedOrigins);
  if (appOrigin) configuredOrigins.unshift(appOrigin.trim());

  const normalizedOrigins = configuredOrigins
    .map((rawOrigin) => {
      try {
        const url = new URL(rawOrigin);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        return url.origin;
      } catch {
        return null;
      }
    })
    .filter((origin): origin is string => !!origin);

  return [...new Set(normalizedOrigins)];
}

function getAllowedPathPrefixes(appAllowedPurchasePathPrefixes?: string | null): string[] {
  const configuredPathPrefixes = parseCsvList(appAllowedPurchasePathPrefixes);
  if (configuredPathPrefixes.length > 0) return configuredPathPrefixes;
  return ["/assets/"];
}

export function validatePurchaseRedirectUrl(
  value: unknown,
  options: PurchaseRedirectValidationOptions,
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "must be a non-empty absolute URL" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return { ok: false, error: "must be a valid absolute URL" };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { ok: false, error: "must use http or https" };
  }

  const allowedOrigins = getAllowedOrigins(options.appOrigin, options.appAllowedOrigins);
  if (allowedOrigins.length === 0) {
    return { ok: false, error: "allowed origins are not configured" };
  }

  if (!allowedOrigins.includes(parsedUrl.origin)) {
    return {
      ok: false,
      error: `origin ${parsedUrl.origin} is not in allowlist`,
    };
  }

  const allowedPathPrefixes = getAllowedPathPrefixes(options.appAllowedPurchasePathPrefixes);
  if (!allowedPathPrefixes.some((pathPrefix) => parsedUrl.pathname.startsWith(pathPrefix))) {
    return {
      ok: false,
      error: `path ${parsedUrl.pathname} is not an allowed purchase route`,
    };
  }

  const purchaseState = parsedUrl.searchParams.get("purchase");
  if (!purchaseState || !ALLOWED_PURCHASE_STATUSES.has(purchaseState)) {
    return {
      ok: false,
      error: "query parameter purchase must be success or cancel",
    };
  }

  return { ok: true, normalizedUrl: parsedUrl.toString() };
}
