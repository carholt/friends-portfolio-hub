import * as XLSX from "xlsx";

export type NormalizedTransactionType = "buy" | "sell" | "dividend" | "fee" | "fx" | "unknown";

export interface NormalizedTransaction {
  broker: string;
  trade_id: string | null;
  trade_type: NormalizedTransactionType;
  symbol_raw: string | null;
  isin: string | null;
  exchange_raw: string | null;
  exchange_code: string | null;
  provider_symbol: string | null;
  traded_at: string | null;
  settle_at: string | null;
  quantity: number;
  price: number | null;
  trade_currency: string | null;
  fx_rate: number | null;
  fees: number | null;
  gross: number | null;
  net: number | null;
  base_currency: string;
  raw_row: Record<string, unknown>;
  stable_row_hash: string;
}

export interface ParsedImportPreviewRow {
  tx: NormalizedTransaction;
  errors: string[];
  duplicateKey: string;
  inferredAssetKey: string | null;
}

type RawRow = Record<string, unknown>;

const NORDEA_HEADERS = ["Affärsnr", "Transaktionstyp", "Ticker", "Marknad", "Avslutsdatum", "Likviddag", "Antal/Nominellt"];

const NORDEA_EXCHANGE_MAP: Record<string, { exchange_code: string; suffix: string }> = {
  "toronto stock exchange": { exchange_code: "TSX", suffix: ".TO" },
  "toronto venture exchange": { exchange_code: "TSXV", suffix: ".V" },
};

const typeMap: Record<string, NormalizedTransactionType> = {
  köp: "buy",
  sälj: "sell",
  utdelning: "dividend",
  courtage: "fee",
  avgift: "fee",
  valutaväxling: "fx",
};

const normalizeHeader = (s: string) => s.trim().toLowerCase();
const normalizeText = (v: unknown) => String(v ?? "").trim();

export function mapNordeaExchange(value?: string | null): { exchange_code: string | null; suffix: string | null } {
  const key = normalizeText(value).toLowerCase();
  const mapped = NORDEA_EXCHANGE_MAP[key];
  return mapped ? { exchange_code: mapped.exchange_code, suffix: mapped.suffix } : { exchange_code: null, suffix: null };
}

export function buildProviderSymbol(symbol: string | null | undefined, exchangeCode?: string | null): string | null {
  const cleanedSymbol = normalizeText(symbol).toUpperCase();
  if (!cleanedSymbol) return null;
  const { suffix } = mapNordeaExchange(exchangeCode === "TSX" ? "Toronto Stock Exchange" : exchangeCode === "TSXV" ? "Toronto Venture Exchange" : undefined);
  if (suffix) return `${cleanedSymbol}${suffix}`;
  if (exchangeCode === "TSX") return `${cleanedSymbol}.TO`;
  if (exchangeCode === "TSXV") return `${cleanedSymbol}.V`;
  return cleanedSymbol;
}

export function detectDelimiter(text: string): ";" | "," {
  const first = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const semicolons = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

function parseNumber(value: unknown): number | null {
  const str = normalizeText(value);
  if (!str) return null;
  const cleaned = str.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function parseFlexibleDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const str = normalizeText(value);
  if (!str) return null;

  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return str;

  const normalized = str
    .replace(/\bCET\b/, "GMT+0100")
    .replace(/\bCEST\b/, "GMT+0200")
    .replace(/\s+/g, " ");
  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return null;
}

function splitCsvLine(line: string, delimiter: string) {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

export function parseCsvRows(text: string): RawRow[] {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) return [];
  const delimiter = detectDelimiter(normalized);
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    const row: RawRow = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

export function parseXlsxRows(fileData: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(fileData, { type: "array" });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawRow>(firstSheet, { defval: null, raw: false });
}

export function detectBrokerByHeaders(rows: RawRow[]): "nordea" | "generic" {
  if (rows.length === 0) return "generic";
  const keys = Object.keys(rows[0]);
  const normalized = new Set(keys.map(normalizeHeader));
  const matches = NORDEA_HEADERS.filter((h) => normalized.has(normalizeHeader(h))).length;
  return matches >= 5 ? "nordea" : "generic";
}

function createStableHash(row: RawRow): string {
  const canonical = Object.keys(row)
    .sort()
    .map((key) => `${key}:${normalizeText(row[key])}`)
    .join("|");

  let hash = 0;
  for (let i = 0; i < canonical.length; i += 1) {
    hash = (hash * 31 + canonical.charCodeAt(i)) >>> 0;
  }

  return `row-${hash.toString(16)}`;
}

function mapNordeaRow(row: RawRow): NormalizedTransaction {
  const tradeTypeRaw = normalizeText(row["Transaktionstyp"]).toLowerCase();
  const trade_type = typeMap[tradeTypeRaw] || "unknown";
  const symbolRaw = normalizeText(row["Ticker"] || row["Symbol"]).toUpperCase() || null;
  const { exchange_code } = mapNordeaExchange(normalizeText(row["Marknad"]));

  return {
    broker: "nordea",
    trade_id: normalizeText(row["Affärsnr"]) || null,
    trade_type,
    symbol_raw: symbolRaw,
    isin: normalizeText(row["ISIN"]) || null,
    exchange_raw: normalizeText(row["Marknad"]) || null,
    exchange_code,
    provider_symbol: buildProviderSymbol(symbolRaw, exchange_code),
    traded_at: parseFlexibleDate(row["Avslutsdatum"]),
    settle_at: parseFlexibleDate(row["Likviddag"]),
    quantity: parseNumber(row["Antal/Nominellt"]) ?? 0,
    price: parseNumber(row["Kurs"]),
    trade_currency: normalizeText(row["Valuta"]).toUpperCase() || null,
    fx_rate: parseNumber(row["Valutakurs"]),
    fees: parseNumber(row["Courtage"]),
    gross: parseNumber(row["Belopp i utländsk valuta"]),
    net: parseNumber(row["Belopp i SEK"]),
    base_currency: "SEK",
    raw_row: row,
    stable_row_hash: createStableHash(row),
  };
}

export function buildPreviewRows(rows: RawRow[], broker: "nordea" | "generic"): ParsedImportPreviewRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const tx = broker === "nordea" ? mapNordeaRow(row) : mapNordeaRow(row);
    const errors: string[] = [];

    if (!tx.trade_id && !tx.stable_row_hash) errors.push("Saknar Affärsnr eller stabil radidentitet");
    if (!tx.symbol_raw) errors.push("Saknar Ticker");
    if (!tx.traded_at) errors.push("Kunde inte tolka Avslutsdatum");
    if (normalizeText(row["Likviddag"]) && !tx.settle_at) errors.push("Kunde inte tolka Likviddag");

    if (tx.trade_type === "buy" || tx.trade_type === "sell") {
      if (!Number.isFinite(tx.quantity) || tx.quantity <= 0) errors.push("Antal måste vara större än 0 för köp/sälj");
    }

    const duplicateKey = tx.trade_id ? `${tx.broker}:${tx.trade_id}` : `${tx.broker}:${tx.stable_row_hash}`;
    if (seen.has(duplicateKey)) errors.push("Dublett i filen (samma Affärsnr/rad)");
    seen.add(duplicateKey);

    return { tx, errors, duplicateKey, inferredAssetKey: tx.isin || tx.symbol_raw || null };
  });
}
