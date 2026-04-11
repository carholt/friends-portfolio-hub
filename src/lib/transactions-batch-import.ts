import { supabase } from "@/integrations/supabase/client";
import type { ParsedImportPreviewRow } from "@/lib/transaction-import";

export interface ImportTransactionsBatchSummary {
  processed: number;
  skipped: number;
  holdings_rebuilt: boolean;
}

export async function importTransactionsBatch(
  portfolioId: string,
  rows: ParsedImportPreviewRow[]
): Promise<ImportTransactionsBatchSummary> {
  // Offline-safe note: this import path only sends already-parsed rows to Postgres RPC.
  // It does not call resolveIsins / resolve-isin-batch edge functions.
  const payload = rows.map(({ tx }) => ({
    broker: tx.broker,
    trade_id: tx.trade_id,
    stable_hash: tx.stable_hash,
    trade_type: tx.trade_type,
    symbol_raw: tx.symbol_raw,
    isin: tx.isin,
    exchange_raw: tx.exchange_raw,
    exchange_code: tx.exchange_code,
    price_symbol: tx.price_symbol,
    traded_at: tx.traded_at,
    quantity: tx.quantity,
    price: tx.price,
    currency: tx.currency,
    fx_rate: tx.fx_rate,
    fees: tx.fees,
    raw_row: tx.raw_row,
  }));

  const { data, error } = await supabase.rpc(
    "import_transactions_batch" as never,
    {
      _portfolio_id: portfolioId,
      _rows_json: payload,
    } as never
  );

  if (error) throw error;

  const summary = (data ?? {}) as Record<string, unknown>;

  return {
    processed: Number(summary.processed ?? payload.length),
    skipped: Number(summary.skipped ?? 0),
    holdings_rebuilt: Boolean(summary.holdings_rebuilt ?? false),
  };
}
