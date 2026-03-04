export type TransactionType = "buy" | "sell" | "adjust" | "remove";

export interface LedgerTransaction {
  type: TransactionType;
  quantity: number;
  price?: number | null;
}

export interface HoldingSnapshot {
  quantity: number;
  avgCost: number;
  realizedPl: number;
}

export function applyTransaction(snapshot: HoldingSnapshot, tx: LedgerTransaction): HoldingSnapshot {
  if (tx.type === "remove") {
    return { quantity: 0, avgCost: 0, realizedPl: snapshot.realizedPl };
  }

  const qty = Number(tx.quantity);
  const price = tx.price == null ? null : Number(tx.price);

  if (tx.type === "buy" || (tx.type === "adjust" && qty > 0)) {
    const nextQty = snapshot.quantity + qty;
    const nextAvg = nextQty > 0
      ? ((snapshot.quantity * snapshot.avgCost) + (qty * Number(price ?? snapshot.avgCost ?? 0))) / nextQty
      : 0;
    return { ...snapshot, quantity: nextQty, avgCost: nextAvg };
  }

  const sellQty = Math.min(Math.abs(qty), snapshot.quantity);
  const realized = price == null ? 0 : (price - snapshot.avgCost) * sellQty;
  const nextQty = Math.max(snapshot.quantity - sellQty, 0);

  return {
    quantity: nextQty,
    avgCost: nextQty === 0 ? 0 : snapshot.avgCost,
    realizedPl: snapshot.realizedPl + realized,
  };
}

export function calculateHoldingFromTransactions(txs: LedgerTransaction[]): HoldingSnapshot {
  return txs.reduce(
    (snapshot, tx) => applyTransaction(snapshot, tx),
    { quantity: 0, avgCost: 0, realizedPl: 0 } as HoldingSnapshot,
  );
}
