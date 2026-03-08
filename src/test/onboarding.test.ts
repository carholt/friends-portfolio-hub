import { describe, expect, it } from "vitest";
import { shouldShowOnboarding } from "@/lib/onboarding";

describe("onboarding visibility", () => {
  it("hides onboarding when onboarding_completed=true", () => {
    expect(shouldShowOnboarding({ profileLoaded: true, profileError: false, onboardingCompleted: true, portfolioCount: 0, dismissed: false })).toBe(false);
  });

  it("hides onboarding when portfolio exists", () => {
    expect(shouldShowOnboarding({ profileLoaded: true, profileError: false, onboardingCompleted: false, portfolioCount: 1, dismissed: false })).toBe(false);
  });

  it("is closable via dismissed state", () => {
    expect(shouldShowOnboarding({ profileLoaded: true, profileError: false, onboardingCompleted: false, portfolioCount: 0, dismissed: true })).toBe(false);
  });

  it("fails open on profile query failure", () => {
    expect(shouldShowOnboarding({ profileLoaded: false, profileError: true, onboardingCompleted: false, portfolioCount: 0, dismissed: false })).toBe(false);
  });
});
