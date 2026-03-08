import { describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { importTransactionsBatch } from "@/lib/transactions-batch-import";
import type { ParsedImportPreviewRow } from "@/lib/transaction-import";

describe("importTransactionsBatch", () => {
  it("calls a single batch RPC with all rows", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { processed: 2, skipped: 1, holdings_rebuilt: true },
      error: null,
    });

    const rows: ParsedImportPreviewRow[] = [
      {
        duplicateKey: "k1",
        errors: [],
        tx: {
          broker: "nordea",
          trade_id: "T-1",
          stable_hash: "tx-1",
          trade_type: "buy",
          symbol_raw: "AYA",
          isin: null,
          exchange_raw: "Toronto",
          exchange_code: "TSX",
          price_symbol: "AYA:TSX",
          traded_at: "2025-01-01",
          quantity: 10,
          price: 1,
          currency: "SEK",
          fx_rate: null,
          fees: 0,
          raw_row: {},
        },
      },
      {
        duplicateKey: "k2",
        errors: [],
        tx: {
          broker: "nordea",
          trade_id: null,
          stable_hash: "tx-2",
          trade_type: "buy",
          symbol_raw: "AYA",
          isin: null,
          exchange_raw: "Toronto",
          exchange_code: "TSX",
          price_symbol: "AYA:TSX",
          traded_at: "2025-01-02",
          quantity: 20,
          price: 2,
          currency: "SEK",
          fx_rate: null,
          fees: 0,
          raw_row: {},
        },
      },
    ];

    const summary = await importTransactionsBatch("portfolio-1", rows);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("import_transactions_batch", {
      _portfolio_id: "portfolio-1",
      _rows_json: expect.arrayContaining([
        expect.objectContaining({ trade_id: "T-1" }),
        expect.objectContaining({ stable_hash: "tx-2" }),
      ]),
    });
    expect(summary).toEqual({ processed: 2, skipped: 1, holdings_rebuilt: true });
  });
});
