import * as XLSX from "xlsx";
import { detectMapping, mapExchangeToPriceSymbol, parseDelimitedFile, parseNumberByLocale, type ImportMapping } from "@/lib/import-engine";

export type NormalizedTransactionType = "buy" | "sell" | "dividend" | "fee" | "fx" | "unknown";
export type BrokerKind = "nordea" | "avanza" | "unknown";

export interface NormalizedTransaction {
  broker: string;
  trade_id: string | null;
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
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString().slice(0, 10);
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
  return detectMapping(Object.keys(rows[0]), rows.slice(0, 10) as Record<string, string>[]).broker_key;
}

export function parseCsvRows(text: string): RawRow[] {
  return parseDelimitedFile(text).rows;
}

export function parseXlsxRows(fileData: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(fileData, { type: "array" });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawRow>(firstSheet, { defval: null, raw: false });
}

export function buildPriceSymbol(symbol: string | null | undefined, exchangeCode?: string | null): string | null {
  return mapExchangeToPriceSymbol(symbol, exchangeCode).price_symbol;
}

export function mapNordeaExchange(value?: string | null) {
  const mapped = mapExchangeToPriceSymbol("TMP", value);
  return { exchange_code: mapped.exchange_code, price_symbol: mapped.price_symbol };
}

const stableHash = (row: RawRow) => {
  const str = Object.keys(row).sort().map((key) => `${key}:${normalize(row[key])}`).join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return `row-${hash.toString(16)}`;
};

export function buildPreviewRows(rows: RawRow[], mapping: ImportMapping): ParsedImportPreviewRow[] {
  const seen = new Set<string>();
  const decimal = mapping.decimal;

  return rows.map((row) => {
    const tradeId = normalize(row[mapping.columns.trade_id || ""]) || stableHash(row);
    const symbol = normalize(row[mapping.columns.symbol || ""]).toUpperCase() || null;
    const exchangeRaw = normalize(row[mapping.columns.exchange || ""]) || null;
    const exchangeMapping = mapExchangeToPriceSymbol(symbol, exchangeRaw);
    const normalizedTx: NormalizedTransaction = {
      broker: mapping.broker_key,
      trade_id: tradeId,
      trade_type: mapType(normalize(row[mapping.columns.trade_type || ""])),
      symbol_raw: symbol,
      isin: normalize(row[mapping.columns.isin || ""]) || null,
      exchange_raw: exchangeRaw,
      exchange_code: exchangeMapping.exchange_code,
      price_symbol: exchangeMapping.price_symbol,
      traded_at: parseDate(row[mapping.columns.date || ""], mapping.date_parser),
      quantity: parseNumberByLocale(normalize(row[mapping.columns.quantity || ""]), decimal) ?? 0,
      price: parseNumberByLocale(normalize(row[mapping.columns.price || ""]), decimal),
      currency: normalize(row[mapping.columns.currency || ""]).toUpperCase() || null,
      fx_rate: null,
      fees: parseNumberByLocale(normalize(row[mapping.columns.fees || ""]), decimal),
      raw_row: row,
    };

    const errors: string[] = [];
    if (!mapping.columns.symbol) errors.push("Could not detect ticker column");
    if (normalizedTx.symbol_raw && !normalizedTx.exchange_code && ["TSX", "TSXV"].some((k) => (normalizedTx.exchange_raw || "").toUpperCase().includes(k))) {
      errors.push("Ticker present but exchange missing (required for TSXV/TSX)");
    }
    if (!Number.isFinite(normalizedTx.quantity) || normalizedTx.quantity === 0) errors.push("Could not parse quantity");
    if (!normalizedTx.traded_at) errors.push("Unknown date format");

    const duplicateKey = `${normalizedTx.broker}:${normalizedTx.trade_id}`;
    if (seen.has(duplicateKey)) errors.push("Duplicate trade id in file");
    seen.add(duplicateKey);
    return { tx: normalizedTx, errors, duplicateKey };
  });
}
