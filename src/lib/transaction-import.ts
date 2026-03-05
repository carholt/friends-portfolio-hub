import * as XLSX from "xlsx";

export type NormalizedTransactionType = "buy" | "sell" | "dividend" | "fee" | "deposit" | "withdrawal" | "split" | "transfer";

export interface NormalizedTransaction {
  broker: string;
  external_id: string | null;
  type: NormalizedTransactionType;
  trade_date: string | null;
  settle_date: string | null;
  isin: string | null;
  symbol: string | null;
  exchange: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;
  price_currency: string | null;
  fx_rate: number | null;
  fees: number | null;
  fees_currency: string | null;
  total_local: number | null;
  total_foreign: number | null;
  raw: Record<string, unknown>;
}

export interface ParsedImportPreviewRow {
  tx: NormalizedTransaction;
  errors: string[];
  duplicateKey: string | null;
  inferredAssetKey: string | null;
}

type RawRow = Record<string, unknown>;

const NORDEA_HEADERS = ["Affärsnr", "Transaktionstyp", "Avslutsdatum", "Likviddag", "Antal/Nominellt", "Courtage", "Belopp i SEK"];

const typeMap: Record<string, NormalizedTransactionType> = {
  köp: "buy",
  buy: "buy",
  purchase: "buy",
  sälj: "sell",
  sell: "sell",
  utdelning: "dividend",
  dividend: "dividend",
  courtage: "fee",
  avgift: "fee",
  fee: "fee",
  insättning: "deposit",
  deposit: "deposit",
  uttag: "withdrawal",
  withdrawal: "withdrawal",
  split: "split",
  transfer: "transfer",
};

const normalizeHeader = (s: string) => s.trim().toLowerCase();

export function detectDelimiter(text: string): ";" | "," {
  const first = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const semicolons = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const cleaned = str.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function parseFlexibleDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  if (!str) return null;
  const cleaned = str.replace(/\s+CET|\s+CEST/g, " GMT+0100");
  const date = new Date(cleaned);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const simple = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (simple) return str;
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

function mapNordeaRow(row: RawRow): NormalizedTransaction {
  const txType = typeMap[String(row["Transaktionstyp"] || "").trim().toLowerCase()] || "transfer";
  const quantity = parseNumber(row["Antal/Nominellt"]);
  const price = parseNumber(row["Kurs"]);
  const fees = parseNumber(row.Courtage);
  const totalSek = parseNumber(row["Belopp i SEK"]);

  return {
    broker: "nordea",
    external_id: String(row["Affärsnr"] || "").trim() || null,
    type: txType,
    trade_date: parseFlexibleDate(row.Avslutsdatum),
    settle_date: parseFlexibleDate(row.Likviddag),
    isin: String(row.ISIN || "").trim() || null,
    symbol: String(row.Symbol || row.Ticker || "").trim().toUpperCase() || null,
    exchange: String(row.Marknadsplats || row.Exchange || "").trim() || null,
    name: String(row.Värdepapper || row.Namn || "").trim() || null,
    quantity,
    price,
    price_currency: "SEK",
    fx_rate: null,
    fees,
    fees_currency: fees == null ? null : "SEK",
    total_local: totalSek,
    total_foreign: null,
    raw: row,
  };
}

export function mapGenericRow(row: RawRow, mapping: Record<string, string>): NormalizedTransaction {
  const value = (key: string) => row[mapping[key]];
  const rawType = String(value("type") || "").trim().toLowerCase();
  return {
    broker: "generic",
    external_id: String(value("external_id") || "").trim() || null,
    type: typeMap[rawType] || "transfer",
    trade_date: parseFlexibleDate(value("trade_date")),
    settle_date: parseFlexibleDate(value("settle_date")),
    isin: String(value("isin") || "").trim() || null,
    symbol: String(value("symbol") || "").trim().toUpperCase() || null,
    exchange: String(value("exchange") || "").trim() || null,
    name: String(value("name") || "").trim() || null,
    quantity: parseNumber(value("quantity")),
    price: parseNumber(value("price")),
    price_currency: String(value("price_currency") || "").trim().toUpperCase() || null,
    fx_rate: parseNumber(value("fx_rate")),
    fees: parseNumber(value("fees")),
    fees_currency: String(value("fees_currency") || "").trim().toUpperCase() || null,
    total_local: parseNumber(value("total_local")),
    total_foreign: parseNumber(value("total_foreign")),
    raw: row,
  };
}

export function buildPreviewRows(rows: RawRow[], broker: "nordea" | "generic", mapping?: Record<string, string>): ParsedImportPreviewRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const tx = broker === "nordea" ? mapNordeaRow(row) : mapGenericRow(row, mapping || {});
    const errors: string[] = [];
    if (!tx.type) errors.push("Missing transaction type");
    if (!tx.trade_date) errors.push("Missing/invalid trade date");
    if (tx.type === "buy" || tx.type === "sell") {
      if (tx.quantity == null || tx.quantity <= 0) errors.push("Quantity must be > 0 for buy/sell");
      if (tx.price == null || tx.price < 0) errors.push("Price must be >= 0 for buy/sell");
    }
    const duplicateKey = tx.external_id ? `${tx.broker}:${tx.external_id}` : null;
    const duplicate = duplicateKey && seen.has(duplicateKey);
    if (duplicate && duplicateKey) errors.push("Duplicate external id in file");
    if (duplicateKey) seen.add(duplicateKey);

    const inferredAssetKey = tx.isin || tx.symbol || null;
    if (!inferredAssetKey) errors.push("No inferable asset key (ISIN/symbol)");

    return { tx, errors, duplicateKey, inferredAssetKey };
  });
}
