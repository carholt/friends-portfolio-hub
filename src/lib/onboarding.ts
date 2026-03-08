export interface OnboardingProfile {
  onboarding_completed?: boolean | null;
}

export function shouldShowOnboarding(profile?: OnboardingProfile | null): boolean {
  if (!profile) return false;
  if (profile.onboarding_completed === true) return false;
  return true;
}
