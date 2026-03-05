export type SymbolResolutionStatus = "unknown" | "resolved" | "ambiguous" | "invalid";

export interface SymbolCandidate {
  price_symbol: string;
  exchange_code: string | null;
  name: string;
  currency: string | null;
  score: number;
  provider: string;
}

const KNOWN_EXCHANGE_CODES = new Set(["TSXV", "TSX", "NYSE", "NASDAQ"]);

export const isExchangeAsSymbol = (symbol: string) => KNOWN_EXCHANGE_CODES.has(symbol.trim().toUpperCase());

export const pickBestCandidate = (candidates: SymbolCandidate[]) => {
  if (!candidates.length) {
    return { status: "invalid" as SymbolResolutionStatus, candidate: null };
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const second = sorted[1];

  if (best.score >= 85 && (!second || best.score - second.score >= 8)) {
    return { status: "resolved" as SymbolResolutionStatus, candidate: best };
  }

  return { status: "ambiguous" as SymbolResolutionStatus, candidate: best };
};

export const applyImportResolution = (symbol: string, candidates: SymbolCandidate[]) => {
  if (isExchangeAsSymbol(symbol)) {
    return { status: "invalid" as SymbolResolutionStatus, reason: "symbol is exchange code" };
  }

  const selection = pickBestCandidate(candidates);
  if (selection.status === "invalid") {
    return { status: "invalid" as SymbolResolutionStatus, reason: "no provider candidates" };
  }

  if (selection.status === "ambiguous") {
    return { status: "ambiguous" as SymbolResolutionStatus, reason: "multiple possible listings", best: selection.candidate };
  }

  return { status: "resolved" as SymbolResolutionStatus, best: selection.candidate };
};
