import { describe, expect, it } from "vitest";
import { validatePurchaseRedirectUrl } from "../../supabase/functions/purchase-report/url-validation";

describe("validatePurchaseRedirectUrl", () => {
  const options = {
    appOrigin: "https://app.example.com",
    appAllowedOrigins: "https://preview.example.com,http://localhost:5173",
    appAllowedPurchasePathPrefixes: "/assets/",
  };

  it("accepts an allowed production URL", () => {
    const result = validatePurchaseRedirectUrl("https://app.example.com/assets/NVDA?purchase=success", options);

    expect(result).toEqual({
      ok: true,
      normalizedUrl: "https://app.example.com/assets/NVDA?purchase=success",
    });
  });

  it("accepts allowed preview and local URLs", () => {
    const previewResult = validatePurchaseRedirectUrl("https://preview.example.com/assets/TSLA?purchase=cancel", options);
    const localResult = validatePurchaseRedirectUrl("http://localhost:5173/assets/AAPL?purchase=success", options);

    expect(previewResult.ok).toBe(true);
    expect(localResult.ok).toBe(true);
  });

  it("rejects external domain URL", () => {
    const result = validatePurchaseRedirectUrl("https://evil.example.net/assets/NVDA?purchase=success", options);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not in allowlist");
    }
  });
});
