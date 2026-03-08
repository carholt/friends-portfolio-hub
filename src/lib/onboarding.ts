export interface OnboardingDecisionInput {
  onboardingCompleted?: boolean | null;
  portfolioCount?: number | null;
  profileLoaded: boolean;
  profileError: boolean;
  dismissed: boolean;
}

export function shouldShowOnboarding(input: OnboardingDecisionInput): boolean {
  if (input.dismissed) return false;
  if (input.profileError) return false;
  if (!input.profileLoaded) return false;
  if (input.onboardingCompleted === true) return false;
  return (input.portfolioCount ?? 0) === 0;
}
