import { supabase } from "@/integrations/supabase/client";

export type ExposureItem = { name: string; value: number; weight?: number; risk?: "low" | "medium" | "high" };
export type StageItem = { stage: string; value: number };
export type InsightItem = { title: string; description: string; severity: "low" | "medium" | "high" };
export type HoldingItem = {
  symbol: string;
  name: string;
  stage: string;
  metal: string;
  jurisdiction: string;
  position_value: number;
  portfolio_weight: number;
  ev_oz_rating: string;
};
export type ValuationSignal = { symbol: string; signal: string; score?: number };
export type ValuationPoint = { date: string; value: number };

type LooseRecord = Record<string, unknown>;

export interface MiningDashboardData {
  exposureByMetal: ExposureItem[];
  exposureByJurisdiction: ExposureItem[];
  stageBreakdown: StageItem[];
  valuationSummary: {
    portfolioValue: number;
    dailyChange: number;
    dailyChangePct?: number;
    return30d: number;
    return30dPct?: number;
    holdingsCount: number;
    timeline: ValuationPoint[];
    deepValue: ValuationSignal[];
  };
  insights: InsightItem[];
  holdings: HoldingItem[];
}

function toNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asRecord(value: unknown): LooseRecord {
  return typeof value === "object" && value !== null ? (value as LooseRecord) : {};
}

function normalizeSeverity(value: unknown): "low" | "medium" | "high" {
  const v = String(value || "").toLowerCase();
  if (v.includes("high")) return "high";
  if (v.includes("med")) return "medium";
  return "low";
}

function mapExposure(data: unknown): ExposureItem[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const item = asRecord(raw);
    return {
      name: String(item.name ?? item.metal ?? item.jurisdiction ?? "Unknown"),
      value: toNumber(item.value ?? item.exposure ?? item.amount),
      weight: item.weight == null ? undefined : toNumber(item.weight),
      risk: item.risk ? normalizeSeverity(item.risk) : undefined,
    };
  });
}

function mapTimeline(data: unknown): ValuationPoint[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((raw) => {
      const item = asRecord(raw);
      return { date: String(item.date ?? item.as_of_date ?? ""), value: toNumber(item.value ?? item.total_value) };
    })
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mapInsights(data: unknown): InsightItem[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const item = asRecord(raw);
    return {
      title: String(item.title ?? "Insight"),
      description: String(item.description ?? item.message ?? ""),
      severity: normalizeSeverity(item.severity),
    };
  });
}

function mapHoldings(data: unknown): HoldingItem[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const item = asRecord(raw);
    return {
      symbol: String(item.symbol ?? "-"),
      name: String(item.name ?? item.company_name ?? "Unknown"),
      stage: String(item.stage ?? "Unknown"),
      metal: String(item.metal ?? "Other"),
      jurisdiction: String(item.jurisdiction ?? item.country ?? "Unknown"),
      position_value: toNumber(item.position_value ?? item.value),
      portfolio_weight: toNumber(item.portfolio_weight ?? item.weight),
      ev_oz_rating: String(item.ev_oz_rating ?? item.rating ?? "N/A"),
    };
  });
}

function mapSignals(data: unknown): ValuationSignal[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const item = asRecord(raw);
    return {
      symbol: String(item.symbol ?? "-"),
      signal: String(item.signal ?? item.label ?? "Fair Value"),
      score: item.score == null ? undefined : toNumber(item.score),
    };
  });
}


type RpcErrorLike = { code?: string; message?: string } | null | undefined;

function shouldRetryWithLegacyArgument(error: RpcErrorLike) {
  if (!error || error.code !== "PGRST202") return false;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("get_portfolio_mining_dashboard") && message.includes("_portfolio_id");
}

async function requestMiningDashboard(portfolioId: string, useLegacyArgument = false) {
  return supabase.rpc("get_portfolio_mining_dashboard" as never, {
    [useLegacyArgument ? "_portfolio_id" : "portfolio_id"]: portfolioId,
  } as never);
}

export async function fetchMiningDashboard(portfolioId: string): Promise<MiningDashboardData> {
  let { data, error } = await requestMiningDashboard(portfolioId);

  if (shouldRetryWithLegacyArgument(error)) {
    const fallback = await requestMiningDashboard(portfolioId, true);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;

  const raw = asRecord(data);
  const valuationSummary = asRecord(raw.valuation_summary);
  const stageRaw = Array.isArray(raw.stage_breakdown) ? raw.stage_breakdown : [];

  return {
    exposureByMetal: mapExposure(raw.exposure_by_metal),
    exposureByJurisdiction: mapExposure(raw.exposure_by_jurisdiction),
    stageBreakdown: stageRaw.map((entry) => {
      const item = asRecord(entry);
      return { stage: String(item.stage ?? "Unknown"), value: toNumber(item.value ?? item.count) };
    }),
    valuationSummary: {
      portfolioValue: toNumber(valuationSummary.portfolio_value),
      dailyChange: toNumber(valuationSummary.daily_change),
      dailyChangePct: valuationSummary.daily_change_pct == null ? undefined : toNumber(valuationSummary.daily_change_pct),
      return30d: toNumber(valuationSummary.return_30d),
      return30dPct: valuationSummary.return_30d_pct == null ? undefined : toNumber(valuationSummary.return_30d_pct),
      holdingsCount: toNumber(valuationSummary.number_of_holdings),
      timeline: mapTimeline(valuationSummary.timeline ?? raw.portfolio_valuations ?? raw.performance_series),
      deepValue: mapSignals(valuationSummary.deep_value_assets ?? raw.valuation_signals),
    },
    insights: mapInsights(raw.insights),
    holdings: mapHoldings(raw.holdings),
  };
}
