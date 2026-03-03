export interface TickerResolutionInput {
  isin: string;
  ticker: string;
}

export interface AssetLike {
  id: string;
  symbol: string;
  metadata_json?: Record<string, unknown> | null;
}

export interface HoldingLike {
  id: string;
  portfolio_id: string;
  asset_id: string;
  quantity: number;
  avg_cost: number;
}

export interface HoldingMergeResult {
  toUpdate: Array<{ id: string; quantity: number; avg_cost: number; asset_id?: string }>;
  toDelete: string[];
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function preserveIsinMetadata(metadata: Record<string, unknown> | null | undefined, isin: string) {
  return {
    ...(metadata || {}),
    isin,
  };
}

export function applyTickerResolutionsToRows(rows: any[], resolutions: Record<string, string>) {
  return rows.map((row) => {
    const isin = String(row?.metadata_json?.isin ?? row.symbol ?? "").trim();
    const ticker = resolutions[isin];
    if (!ticker) return row;

    return {
      ...row,
      symbol: normalizeTicker(ticker),
      metadata_json: preserveIsinMetadata((row.metadata_json as Record<string, unknown> | undefined) ?? {}, isin),
    };
  });
}

export function mergeHoldingsForAssetMigration(sourceHoldings: HoldingLike[], targetHoldings: HoldingLike[]): HoldingMergeResult {
  const toUpdate: HoldingMergeResult["toUpdate"] = [];
  const toDelete: string[] = [];
  const targetByPortfolio = new Map(targetHoldings.map((h) => [h.portfolio_id, h]));

  for (const source of sourceHoldings) {
    const target = targetByPortfolio.get(source.portfolio_id);
    if (!target) {
      toUpdate.push({ id: source.id, asset_id: "TARGET", quantity: source.quantity, avg_cost: source.avg_cost });
      continue;
    }

    const totalQty = Number(target.quantity) + Number(source.quantity);
    const weightedAvg = totalQty > 0
      ? ((Number(target.quantity) * Number(target.avg_cost)) + (Number(source.quantity) * Number(source.avg_cost))) / totalQty
      : 0;

    toUpdate.push({ id: target.id, quantity: totalQty, avg_cost: weightedAvg });
    toDelete.push(source.id);
  }

  return { toUpdate, toDelete };
}
