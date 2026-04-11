import * as XLSX from "xlsx";
import { detectMapping, mapExchangeToPriceSymbol, parseDelimitedFile, parseNumberByLocale, type ImportMapping } from "@/lib/import-engine";
import { supabase } from "@/integrations/supabase/client";

export type NormalizedTransactionType = "buy" | "sell" | "dividend" | "fee" | "fx" | "unknown";
export type BrokerKind = "nordea" | "avanza" | "unknown";

export interface NormalizedTransaction {
  broker: string;
  trade_id: string | null;
  stable_hash: string;
  trade_type: NormalizedTransactionType;
  symbol_raw: string | null;
  isin: string | null;
  exchange_raw: string | null;
  exchange_code: string | null;
  price_symbol: string | null;
  traded_at: string | null;
  quantity: number;
  price: number | null;
  currency: string | null;
  fx_rate: number | null;
  fees: number | null;
  raw_row: Record<string, unknown>;
}

export interface ParsedImportPreviewRow {
  tx: NormalizedTransaction;
  errors: string[];
  duplicateKey: string;
}

type RawRow = Record<string, unknown>;

const normalize = (value: unknown) => String(value ?? "").trim();

const parseDate = (value: unknown, parser: ImportMapping["date_parser"]) => {
  const raw = normalize(value);
  if (!raw) return null;

  if (parser === "iso" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (parser === "sv_date") {
    const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime())
    ? null
    : fallback.toISOString().slice(0, 10);
};

const mapType = (value: string): NormalizedTransactionType => {
  const lower = value.toLowerCase();

  if (["köp", "buy"].includes(lower)) return "buy";
  if (["sälj", "sell"].includes(lower)) return "sell";
  if (["utdelning", "dividend"].includes(lower)) return "dividend";
  if (["courtage", "avgift", "fee"].includes(lower)) return "fee";
  if (["valutaväxling", "fx"].includes(lower)) return "fx";

  return "unknown";
};

export function detectBrokerByHeaders(rows: RawRow[]): BrokerKind {
  if (!rows.length) return "unknown";

  return detectMapping(
    Object.keys(rows[0]),
    rows.slice(0, 10) as Record<string, string>[]
  ).broker_key;
}

export function parseCsvRows(text: string): RawRow[] {
  return parseDelimitedFile(text).rows;
}

export function parseXlsxRows(fileData: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(fileData, { type: "array" });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];

  return XLSX.utils.sheet_to_json<RawRow>(firstSheet, {
    defval: null,
    raw: false,
  });
}

export function buildPriceSymbol(
  symbol: string | null | undefined,
  exchangeCode?: string | null
): string | null {
  return mapExchangeToPriceSymbol(symbol, exchangeCode).price_symbol;
}

export function mapNordeaExchange(value?: string | null) {
  const mapped = mapExchangeToPriceSymbol("TMP", value);

  return {
    exchange_code: mapped.exchange_code,
    price_symbol: mapped.price_symbol,
  };
}

const stableStringPart = (
  value: unknown,
  transform?: (next: string) => string
) => {
  const normalized = normalize(value);
  return transform ? transform(normalized) : normalized;
};

const formatStableNumberPart = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(8)
    : "";

const buildStableHashInput = (
  tx: Pick<
    NormalizedTransaction,
    | "broker"
    | "trade_type"
    | "symbol_raw"
    | "isin"
    | "exchange_code"
    | "traded_at"
    | "quantity"
    | "price"
    | "currency"
    | "fees"
  >
) =>
  [
    stableStringPart(tx.broker, (v) => v.toLowerCase()),
    stableStringPart(tx.trade_type, (v) => v.toLowerCase()),
    stableStringPart(tx.symbol_raw, (v) => v.toUpperCase()),
    stableStringPart(tx.isin, (v) => v.toUpperCase()),
    stableStringPart(tx.exchange_code, (v) => v.toUpperCase()),
    stableStringPart(tx.traded_at),
    Number.isFinite(tx.quantity) ? tx.quantity.toFixed(8) : "",
    formatStableNumberPart(tx.price),
    stableStringPart(tx.currency, (v) => v.toUpperCase()),
    formatStableNumberPart(tx.fees),
  ].join("|");

export function computeStableHashFromNormalizedFields(
  tx: Pick<
    NormalizedTransaction,
    | "broker"
    | "trade_type"
    | "symbol_raw"
    | "isin"
    | "exchange_code"
    | "traded_at"
    | "quantity"
    | "price"
    | "currency"
    | "fees"
  >
) {
  const input = buildStableHashInput(tx);

  let hash = 0;

  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }

  return `tx-${hash.toString(16)}`;
}

export function buildPreviewRows(
  rows: RawRow[],
  mapping: ImportMapping
): ParsedImportPreviewRow[] {
  const seen = new Set<string>();
  const decimal = mapping.decimal;

  return rows.map((row) => {
    const tradeId =
      normalize(row[mapping.columns.trade_id || ""]) || null;

    const symbol =
      normalize(row[mapping.columns.symbol || ""]).toUpperCase() ||
      null;

    const exchangeRaw =
      normalize(row[mapping.columns.exchange || ""]) || null;

    const exchangeMapping = mapExchangeToPriceSymbol(
      symbol,
      exchangeRaw
    );

    const txBase = {
      broker: mapping.broker_key,
      trade_id: tradeId,
      trade_type: mapType(
        normalize(row[mapping.columns.trade_type || ""])
      ),
      symbol_raw: symbol,
      isin: normalize(row[mapping.columns.isin || ""]).toUpperCase() || null,
      exchange_raw: exchangeRaw,
      exchange_code: exchangeMapping.exchange_code,
      price_symbol: exchangeMapping.price_symbol,
      traded_at: parseDate(
        row[mapping.columns.date || ""],
        mapping.date_parser
      ),
      quantity:
        parseNumberByLocale(
          normalize(row[mapping.columns.quantity || ""]),
          decimal
        ) ?? 0,
      price: parseNumberByLocale(
        normalize(row[mapping.columns.price || ""]),
        decimal
      ),
      currency:
        normalize(row[mapping.columns.currency || ""]).toUpperCase() ||
        null,
      fees: parseNumberByLocale(
        normalize(row[mapping.columns.fees || ""]),
        decimal
      ),
    };

    const normalizedTx: NormalizedTransaction = {
      ...txBase,
      stable_hash: computeStableHashFromNormalizedFields(txBase),
      fx_rate: null,
      raw_row: row,
    };

    const errors: string[] = [];

    if (!mapping.columns.symbol)
      errors.push("Could not detect ticker column");

    if (
      normalizedTx.symbol_raw &&
      !normalizedTx.exchange_code &&
      ["TSX", "TSXV"].some((k) =>
        (normalizedTx.exchange_raw || "").toUpperCase().includes(k)
      )
    ) {
      errors.push(
        "Ticker present but exchange missing (required for TSXV/TSX)"
      );
    }

    if (
      !Number.isFinite(normalizedTx.quantity) ||
      normalizedTx.quantity === 0
    ) {
      errors.push("Could not parse quantity");
    }

    if (!normalizedTx.traded_at)
      errors.push("Unknown date format");

    const duplicateKey = normalizedTx.trade_id
      ? `${normalizedTx.broker}:trade:${normalizedTx.trade_id}`
      : `${normalizedTx.broker}:stable:${normalizedTx.stable_hash}`;

    if (seen.has(duplicateKey))
      errors.push("Duplicate transaction in file");

    seen.add(duplicateKey);

    return {
      tx: normalizedTx,
      errors,
      duplicateKey,
    };
  });
}

export interface OfflineImportSummary {
  inserted: number;
  skipped: number;
  unresolved: string[];
}

type ImportedTransactionType = "BUY" | "SELL" | "DIVIDEND" | "DEPOSIT" | "WITHDRAWAL";

interface AvanzaCsvRow {
  date: string;
  type: string;
  name: string;
  isin: string;
  quantity: string;
  price: string;
  amount: string;
  currency: string;
}

const typeMap: Record<string, ImportedTransactionType | "TRANSFER"> = {
  "Köp": "BUY",
  "Sälj": "SELL",
  "Utdelning": "DIVIDEND",
  "Insättning": "DEPOSIT",
  "Autogiroinsättning": "DEPOSIT",
  "Uttag": "WITHDRAWAL",
  "Intern överföring": "TRANSFER",
};

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

const normalizeIsin = (value: unknown) => normalize(value).toUpperCase();

export async function importAvanzaTransactionsCsv(
  portfolioId: string,
  csvContent: string
): Promise<OfflineImportSummary> {
  const unresolved = new Set<string>();
  const seen = new Set<string>();
  const isinTickerCache = new Map<string, string | null>();
  const assetIdCache = new Map<string, string>();
  let inserted = 0;
  let skipped = 0;

  const delimiter = csvContent.includes(";") ? ";" : ",";
  const rows = csvContent
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  if (rows.length < 2) {
    return { inserted: 0, skipped: 0, unresolved: [] };
  }

  const headers = rows[0].split(delimiter).map((h) => h.trim());
  const headerMap = new Map(headers.map((header, index) => [normalize(header), index]));

  const getValue = (columns: string[], values: string[]) => {
    for (const column of columns) {
      const idx = headerMap.get(normalize(column));
      if (typeof idx === "number") return values[idx]?.trim() ?? "";
    }
    return "";
  };

  for (const rawRow of rows.slice(1)) {
    const values = rawRow.split(delimiter).map((v) => v.trim());
    if (values.length !== headers.length) {
      skipped += 1;
      continue;
    }

    const date = parseDate(getValue(["Datum", "date"], values), "sv_date");
    const typeRaw = getValue(["Typ av transaktion", "type"], values);
    const type = typeMap[typeRaw];
    const name = getValue(["Namn", "name"], values);
    const isin = normalizeIsin(getValue(["ISIN", "isin"], values)) || null;
    const quantity = parseNumber(getValue(["Antal", "quantity"], values));
    const price = parseNumber(getValue(["Kurs", "Pris", "price"], values));
    const amount = parseNumber(getValue(["Belopp", "amount"], values));
    const fees = parseNumber(getValue(["Courtage", "fees"], values));
    const fxRate = parseNumber(getValue(["Valutakurs", "fx_rate"], values));
    const currency = getValue(["Valuta", "currency"], values).toUpperCase() || null;

    if (!date || !type || !name || amount === null) {
      skipped += 1;
      continue;
    }

    const dedupeKey = [date, isin || name, type, amount].join("|");
    if (seen.has(dedupeKey)) {
      skipped += 1;
      continue;
    }
    seen.add(dedupeKey);

    let ticker = "";
    try {
      if (isin) {
        if (isinTickerCache.has(isin)) {
          ticker = isinTickerCache.get(isin) || "";
        } else {
          const { data: mapping } = await supabase
            .from("instrument_mappings")
            .select("ticker")
            .eq("isin", isin)
            .maybeSingle();
          ticker = normalize(mapping?.ticker).toUpperCase();
          isinTickerCache.set(isin, ticker || null);
        }
      }
      if (!ticker) {
        ticker = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
        unresolved.add(isin || name);
      }
    } catch (error) {
      console.error("ISIN resolution error:", error);
      ticker = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
      unresolved.add(isin || name);
    }

    if (!ticker) {
      skipped += 1;
      continue;
    }

    try {
      let assetId = assetIdCache.get(ticker);
      if (!assetId) {
        const { data: existing } = await supabase
          .from("assets")
          .select("id")
          .eq("symbol", ticker)
          .maybeSingle();

        assetId = existing?.id ? String(existing.id) : "";
        if (!assetId) {
          const { data: insertedAsset } = await supabase
            .from("assets")
            .insert({ symbol: ticker, name })
            .select("id")
            .single();
          assetId = String(insertedAsset?.id ?? "");
        }
        if (assetId) assetIdCache.set(ticker, assetId);
      }

      if (!assetId) {
        skipped += 1;
        continue;
      }

      await supabase.from("transactions").upsert(
        {
          portfolio_id: portfolioId,
          asset_id: assetId,
          broker: "avanza",
          trade_type: type,
          symbol_raw: ticker,
          isin,
          traded_at: date,
          quantity: quantity ?? 0,
          price,
          amount,
          fees,
          fx_rate: fxRate,
          currency,
          stable_hash: computeStableHashFromNormalizedFields({
            broker: "avanza",
            trade_type: (String(type).toLowerCase() as NormalizedTransactionType) || "unknown",
            symbol_raw: ticker,
            isin,
            exchange_code: null,
            traded_at: date,
            quantity: quantity ?? 0,
            price,
            currency,
            fees,
          }),
        } as never,
        { onConflict: "portfolio_id,broker,stable_hash" }
      );
      inserted += 1;
    } catch (error) {
      console.error("Transaction insert error:", error);
      skipped += 1;
    }
  }

  const result = { inserted, skipped, unresolved: Array.from(unresolved) };
  console.log("Import summary:", {
    inserted,
    skipped,
    unresolvedCount: result.unresolved.length,
  });
  return result;
}
