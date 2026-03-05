export type AccessInput = {
  paywallEnabled: boolean;
  subscriptionTier?: string | null;
  hasPurchase: boolean;
  isOwner?: boolean;
};

export function hasReportAccess(input: AccessInput): boolean {
  if (!input.paywallEnabled) return true;
  if (input.isOwner) return true;

  const tier = (input.subscriptionTier || "free").toLowerCase();
  if (tier === "pro" || tier === "max") return true;

  return input.hasPurchase;
}
