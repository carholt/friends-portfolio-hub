import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPreviewRows, buildPriceSymbol, computeStableHashFromNormalizedFields, detectBrokerByHeaders, mapNordeaExchange, parseCsvRows } from "@/lib/transaction-import";
import { calculateHoldingWithFees } from "@/lib/transactions";
import { detectMapping, type ImportMapping } from "@/lib/import-engine";

describe("Nordea transaction import parsing", () => {
  const fixture = readFileSync(resolve(process.cwd(), "src/test/fixtures/nordea-transactions.csv"), "utf8");

  it("parses nordea fixture and extracts symbols", () => {
    const rows = parseCsvRows(fixture);
    expect(detectBrokerByHeaders(rows)).toBe("nordea");
    const mapping = detectMapping(Object.keys(rows[0]), rows as Record<string, string>[]);
    const preview = buildPreviewRows(rows, mapping);

    expect(preview).toHaveLength(2);
    expect(preview.map((row) => row.tx.symbol_raw)).toEqual(["AYA", "AYA"]);
    expect(preview.every((row) => row.tx.price_symbol === "AYA.TO")).toBe(true);
    expect(preview.every((row) => row.errors.length === 0)).toBe(true);
  });

  it("maps TSX/TSXV and price symbol suffixes", () => {
    expect(mapNordeaExchange("Toronto Stock Exchange")).toEqual({ exchange_code: "TSX", suffix: ".TO" });
    expect(mapNordeaExchange("Toronto Venture Exchange")).toEqual({ exchange_code: "TSXV", suffix: ".V" });
    expect(buildPriceSymbol("AYA", "TSX")).toBe("AYA.TO");
    expect(buildPriceSymbol("AUMB", "TSXV")).toBe("AUMB.V");
  });

  it("computes holdings average cost from buy/sell ledger", () => {
    const result = calculateHoldingWithFees([
      { type: "buy", quantity: 100, price: 1.25, fees: 29 },
      { type: "buy", quantity: 50, price: 10.5, fees: 19 },
      { type: "sell", quantity: 20, price: 12, fees: 15 },
    ]);

    expect(result.quantity).toBe(130);
    expect(result.avgCost).toBeCloseTo(4.6533, 3);
  });

  it("builds deterministic stable hash from normalized fields", () => {
    const hashA = computeStableHashFromNormalizedFields({
      broker: "NORDEA",
      trade_type: "buy",
      symbol_raw: "aya",
      isin: "ca05466c1005",
      exchange_code: "tsx",
      traded_at: "2025-01-10",
      quantity: 100,
      price: 2.5,
      currency: "sek",
      fees: 19,
    });

    const hashB = computeStableHashFromNormalizedFields({
      broker: "nordea",
      trade_type: "BUY",
      symbol_raw: "AYA",
      isin: "CA05466C1005",
      exchange_code: "TSX",
      traded_at: "2025-01-10",
      quantity: 100,
      price: 2.5,
      currency: "SEK",
      fees: 19,
    });

    expect(hashA).toBe(hashB);
  });

  it("re-imports missing trade_id rows without duplication using stable hash", () => {
    const mapping = {
      kind: "transactions",
      broker_key: "nordea",
      delimiter: ",",
      decimal: ".",
      date_parser: "iso",
      columns: {
        trade_type: "type",
        symbol: "symbol",
        isin: "isin",
        exchange: "exchange",
        date: "date",
        quantity: "quantity",
        price: "price",
        currency: "currency",
        fees: "fees",
      },
      transforms: { symbol_cleaning_rules: [], numeric_parse_rules: [], exchange_map_rules: {} },
      confidence: 1,
      questions: [],
    } satisfies ImportMapping;

    const importRows = [
      { type: "buy", symbol: "AYA", isin: "CA05466C1005", exchange: "TSX", date: "2025-01-10", quantity: "100", price: "2.50", currency: "SEK", fees: "19" },
    ];

    const previewA = buildPreviewRows(importRows, mapping);
    const reorderedRows = [{ fees: "19", currency: "SEK", price: "2.50", quantity: "100", date: "2025-01-10", exchange: "TSX", isin: "CA05466C1005", symbol: "AYA", type: "buy" }];
    const previewB = buildPreviewRows(reorderedRows, mapping);

    expect(previewA[0].tx.trade_id).toBeNull();
    expect(previewA[0].tx.stable_hash).toBe(previewB[0].tx.stable_hash);

    const db = new Map<string, { quantity: number }>();
    const upsertWithoutTradeId = (preview: ReturnType<typeof buildPreviewRows>) => {
      let inserts = 0;
      let updates = 0;
      for (const row of preview) {
        const key = `portfolio-1:${row.tx.broker}:${row.tx.stable_hash}`;
        if (db.has(key)) updates += 1;
        else inserts += 1;
        db.set(key, { quantity: row.tx.quantity });
      }
      return { inserts, updates };
    };

    const first = upsertWithoutTradeId(previewA);
    const second = upsertWithoutTradeId(previewB);

    expect(first).toEqual({ inserts: 1, updates: 0 });
    expect(second).toEqual({ inserts: 0, updates: 1 });
    expect(db.size).toBe(1);
  });


  it("uses duplicate key precedence: trade_id first, stable_hash fallback", () => {
    const mapping = {
      kind: "transactions",
      broker_key: "nordea",
      delimiter: ",",
      decimal: ".",
      date_parser: "iso",
      columns: {
        trade_id: "trade_id",
        trade_type: "type",
        symbol: "symbol",
        exchange: "exchange",
        date: "date",
        quantity: "quantity",
        price: "price",
        currency: "currency",
      },
      transforms: { symbol_cleaning_rules: [], numeric_parse_rules: [], exchange_map_rules: {} },
      confidence: 1,
      questions: [],
    } satisfies ImportMapping;

    const rowsWithTradeId = [
      { trade_id: "T-1", type: "buy", symbol: "AYA", exchange: "TSX", date: "2025-01-10", quantity: "100", price: "2.50", currency: "SEK" },
      { trade_id: "T-1", type: "sell", symbol: "AYA", exchange: "TSX", date: "2025-01-11", quantity: "1", price: "2.60", currency: "SEK" },
    ];

    const previewByTradeId = buildPreviewRows(rowsWithTradeId, mapping);
    expect(previewByTradeId[0].duplicateKey).toContain(":trade:T-1");
    expect(previewByTradeId[1].duplicateKey).toContain(":trade:T-1");
    expect(previewByTradeId[1].errors).toContain("Duplicate transaction in file");

    const rowsWithoutTradeId = [
      { type: "buy", symbol: "AYA", exchange: "TSX", date: "2025-01-10", quantity: "100", price: "2.50", currency: "SEK" },
      { currency: "SEK", price: "2.50", quantity: "100", date: "2025-01-10", exchange: "TSX", symbol: "AYA", type: "buy" },
    ];

    const previewByStableHash = buildPreviewRows(rowsWithoutTradeId, mapping);
    expect(previewByStableHash[0].duplicateKey).toContain(":stable:");
    expect(previewByStableHash[1].duplicateKey).toBe(previewByStableHash[0].duplicateKey);
    expect(previewByStableHash[1].errors).toContain("Duplicate transaction in file");
  });

});
