import { describe, expect, it } from "vitest";
import { hasReportAccess } from "@/lib/report-access";

describe("hasReportAccess", () => {
  it("returns true for any user/report when PAYWALL_ENABLED=false", () => {
    expect(hasReportAccess({ paywallEnabled: false, subscriptionTier: "free", hasPurchase: false })).toBe(true);
  });

  it("returns false when PAYWALL_ENABLED=true, tier=free and no purchase", () => {
    expect(hasReportAccess({ paywallEnabled: true, subscriptionTier: "free", hasPurchase: false })).toBe(false);
  });

  it("returns true when PAYWALL_ENABLED=true and tier=pro", () => {
    expect(hasReportAccess({ paywallEnabled: true, subscriptionTier: "pro", hasPurchase: false })).toBe(true);
  });

  it("returns true when PAYWALL_ENABLED=true and purchase exists", () => {
    expect(hasReportAccess({ paywallEnabled: true, subscriptionTier: "free", hasPurchase: true })).toBe(true);
  });
});
