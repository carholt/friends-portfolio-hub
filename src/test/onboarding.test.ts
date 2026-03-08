import { describe, expect, it } from "vitest";
import { shouldShowOnboarding } from "@/lib/onboarding";

describe("onboarding visibility", () => {
  it("hides onboarding when profile is missing", () => {
    expect(shouldShowOnboarding(null)).toBe(false);
  });

  it("hides onboarding when onboarding_completed=true", () => {
    expect(shouldShowOnboarding({ onboarding_completed: true })).toBe(false);
  });

  it("shows onboarding only when onboarding_completed=false", () => {
    expect(shouldShowOnboarding({ onboarding_completed: false })).toBe(true);
  });
});
