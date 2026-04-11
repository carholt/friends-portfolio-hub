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

const mapAvanzaType = (value: string): ImportedTransactionType | null => {
  const normalized = normalize(value).toLowerCase();
  if (normalized === "köp") return "BUY";
  if (normalized === "sälj") return "SELL";
  if (normalized === "utdelning") return "DIVIDEND";
  if (normalized === "insättning") return "DEPOSIT";
  if (normalized === "uttag") return "WITHDRAWAL";
  if (normalized === "autogiroinsättning") return "DEPOSIT";
  return null;
};

const normalizeCsvNumber = (value: unknown): number => {
  const normalized = normalize(value).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeIsin = (value: unknown) => normalize(value).toUpperCase();

const ensureAssets = async (
  rows: Array<{ ticker: string; name: string; currency: string | null }>
) => {
  const tickers = Array.from(new Set(rows.map((row) => row.ticker).filter(Boolean)));
  if (tickers.length === 0) return new Map<string, string>();

  const { data: existing, error: fetchError } = await supabase
    .from("assets")
    .select("id, symbol")
    .in("symbol", tickers);
  if (fetchError) throw fetchError;

  const map = new Map<string, string>();
  for (const asset of existing ?? []) {
    map.set(String(asset.symbol), String(asset.id));
  }

  const missing = rows.filter((row) => !map.has(row.ticker));
  if (missing.length) {
    const uniqueMissing = Array.from(new Map(missing.map((row) => [row.ticker, row])).values());
    const { data: inserted, error: insertError } = await supabase
      .from("assets")
      .upsert(
        uniqueMissing.map((row) => ({
          symbol: row.ticker,
          name: row.name || row.ticker,
          currency: row.currency || "SEK",
        })),
        { onConflict: "symbol" }
      )
      .select("id, symbol");
    if (insertError) throw insertError;

    for (const asset of inserted ?? []) {
      map.set(String(asset.symbol), String(asset.id));
    }
  }

  return map;
};

export async function importAvanzaTransactionsCsv(
  portfolioId: string,
  csvContent: string
): Promise<OfflineImportSummary> {
  const parsed = parseDelimitedFile(csvContent);
  const rows = parsed.rows as unknown as AvanzaCsvRow[];
  const unresolved = new Set<string>();
  const isins = Array.from(new Set(rows.map((row) => normalizeIsin(row.isin)).filter(Boolean)));

  const isinToTicker = new Map<string, string>();
  if (isins.length > 0) {
    const { data, error } = await supabase
      .from("instrument_mappings")
      .select("isin, ticker")
      .in("isin", isins);
    if (error) throw error;

    for (const item of data ?? []) {
      const isin = normalizeIsin(item.isin);
      const ticker = normalize(item.ticker).toUpperCase();
      if (isin && ticker) isinToTicker.set(isin, ticker);
    }
  }

  const normalizedRows = rows.map((row) => {
    const name = normalize((row as Record<string, string>)["namn"] ?? row.name);
    const isin = normalizeIsin((row as Record<string, string>)["isin"] ?? row.isin);
    const ticker = isin ? (isinToTicker.get(isin) ?? name) : name;
    if (isin && !isinToTicker.has(isin)) unresolved.add(isin);

    return {
      traded_at: parseDate((row as Record<string, string>)["datum"] ?? row.date, "sv_date"),
      trade_type: mapAvanzaType((row as Record<string, string>)["typ av transaktion"] ?? row.type),
      quantity: normalizeCsvNumber((row as Record<string, string>)["antal"] ?? row.quantity),
      price: normalizeCsvNumber((row as Record<string, string>)["pris"] ?? row.price),
      amount: normalizeCsvNumber((row as Record<string, string>)["belopp"] ?? row.amount),
      currency: normalize((row as Record<string, string>)["valuta"] ?? row.currency).toUpperCase() || null,
      name,
      isin: isin || null,
      ticker: ticker.toUpperCase(),
    };
  });

  const validRows = normalizedRows.filter((row) => row.trade_type && row.traded_at && row.ticker);
  const skipped = normalizedRows.length - validRows.length;
  const assets = await ensureAssets(validRows.map((row) => ({ ticker: row.ticker, name: row.name, currency: row.currency })));

  const payload = validRows
    .map((row) => {
      const assetId = assets.get(row.ticker);
      if (!assetId) return null;

      const txBase = {
        broker: "avanza",
        trade_type: String(row.trade_type).toLowerCase(),
        symbol_raw: row.ticker,
        isin: row.isin,
        exchange_code: null as string | null,
        traded_at: row.traded_at,
        quantity: row.quantity,
        price: row.price || null,
        currency: row.currency,
        fees: null as number | null,
      };

      return {
        portfolio_id: portfolioId,
        asset_id: assetId,
        broker: "avanza",
        trade_type: String(row.trade_type).toLowerCase(),
        symbol_raw: row.ticker,
        isin: row.isin,
        traded_at: row.traded_at,
        quantity: row.quantity,
        price: row.price || null,
        currency: row.currency,
        stable_hash: computeStableHashFromNormalizedFields(txBase),
      };
    })
    .filter(Boolean);

  if (payload.length === 0) {
    return { inserted: 0, skipped: normalizedRows.length, unresolved: Array.from(unresolved) };
  }

  const { data, error } = await supabase
    .from("transactions")
    .upsert(payload as never, { onConflict: "portfolio_id,broker,stable_hash" })
    .select("id");
  if (error) throw error;

  return {
    inserted: (data ?? []).length,
    skipped,
    unresolved: Array.from(unresolved),
  };
}
