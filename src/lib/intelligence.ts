export interface IntelligenceCalcInput {
  shares: number;
  avgCost: number;
  currentPrice: number | null;
  projectedPrice: number | null;
  portfolioTotal: number;
}

export function calculateIntelligence(input: IntelligenceCalcInput) {
  const investment = input.shares * input.avgCost;
  const currentValue = input.currentPrice == null ? null : input.currentPrice * input.shares;
  const weight = input.portfolioTotal > 0 && currentValue != null ? currentValue / input.portfolioTotal : null;
  const potentialUpside = input.currentPrice && input.projectedPrice ? (input.projectedPrice / input.currentPrice) - 1 : null;
  const roi = investment > 0 && currentValue != null ? (currentValue - investment) / investment : null;
  return { investment, currentValue, weight, potentialUpside, roi, unpriced: input.currentPrice == null };
}
