export type CompanyAiSource = {
  title: string;
  url: string;
  snippet: string;
};

export type CompanyAiReport = {
  ticker: string;
  name: string;
  bucket: string;
  type: string;
  properties_ownership: string;
  management_team: string;
  share_structure: string;
  location: string;
  projected_growth: string;
  market_buzz: string;
  cost_structure_financing: string;
  cash_debt_position: string;
  low_valuation_estimate: number | null;
  high_valuation_estimate: number | null;
  projected_price: number | null;
  investment_recommendation: string;
  rating: string;
  rationale: string;
  key_risks: string[];
  key_catalysts: string[];
  last_updated: string;
  sources: CompanyAiSource[];
};

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableNumber = (value: unknown) => value === null || typeof value === "number";

export function isCompanyAiReport(value: unknown): value is CompanyAiReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const sourceValid = Array.isArray(v.sources) && v.sources.every((source) => {
    if (!source || typeof source !== "object") return false;
    const s = source as Record<string, unknown>;
    return isString(s.title) && isString(s.url) && isString(s.snippet);
  });

  return (
    isString(v.ticker) &&
    isString(v.name) &&
    isString(v.bucket) &&
    isString(v.type) &&
    isString(v.properties_ownership) &&
    isString(v.management_team) &&
    isString(v.share_structure) &&
    isString(v.location) &&
    isString(v.projected_growth) &&
    isString(v.market_buzz) &&
    isString(v.cost_structure_financing) &&
    isString(v.cash_debt_position) &&
    isNullableNumber(v.low_valuation_estimate) &&
    isNullableNumber(v.high_valuation_estimate) &&
    isNullableNumber(v.projected_price) &&
    isString(v.investment_recommendation) &&
    isString(v.rating) &&
    isString(v.rationale) &&
    Array.isArray(v.key_risks) && v.key_risks.every(isString) &&
    Array.isArray(v.key_catalysts) && v.key_catalysts.every(isString) &&
    isString(v.last_updated) &&
    sourceValid
  );
}
