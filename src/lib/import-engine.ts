import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { buildAssetIdentifier } from "@/lib/asset-identifier";

export type ImportKind = "transactions" | "holdings" | "unknown";
export type BrokerKey = "nordea" | "avanza" | "interactive_brokers" | "degiro" | "unknown";

export interface ImportMapping {
  kind: ImportKind;
  broker_key: BrokerKey;
  delimiter: ";" | "," | "\t";
  decimal: "," | ".";
  date_parser: "sv_date" | "iso" | "en_text";
  columns: Partial<Record<"symbol" | "name" | "isin" | "exchange" | "date" | "quantity" | "price" | "currency" | "avg_cost" | "fees" | "amount" | "trade_id" | "trade_type", string>>;
  transforms: {
    symbol_cleaning_rules: string[];
    numeric_parse_rules: string[];
    exchange_map_rules: Record<string, { exchange_code: string; suffix: string }>;
  };
  confidence: number;
  questions: string[];
}

export interface ParsedImportFile {
  headers: string[];
  rows: Record<string, string>[];
  sampleRows: Record<string, string>[];
  delimiter: ";" | "," | "\t";
  fingerprint: string;
}

const normalize = (value: string) => value.trim().toLowerCase();
const clean = (value: string) => value.replace(/^\uFEFF/, "").trim();

export const EXCHANGE_RULES: Record<string, { exchange_code: string; suffix: string }> = {
  "toronto stock exchange": { exchange_code: "TSX", suffix: ".TO" },
  "toronto venture exchange": { exchange_code: "TSXV", suffix: ".V" },
};

export const detectDelimiter = (text: string): ";" | "," | "\t" => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10);
  const candidates: Array<";" | "," | "\t"> = [";", ",", "\t"];
  const score = (delimiter: ";" | "," | "\t") => lines.reduce((acc, line) => acc + (line.split(delimiter).length - 1), 0);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? ",";
};

const splitLine = (line: string, delimiter: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

export const parseDelimitedFile = (content: string): ParsedImportFile => {
  const normalized = clean(content);
  const delimiter = detectDelimiter(normalized);
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  const headers = splitLine(lines[0] ?? "", delimiter).map((header) => clean(header));
  const rows = lines.slice(1).map((line) => {
    const cols = splitLine(line, delimiter);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = clean(cols[index] ?? "");
      return acc;
    }, {});
  });
  const sampleRows = rows.slice(0, 50);
  const sampleSignature = JSON.stringify({ headers, delimiter, sampleRows: sampleRows.slice(0, 10) });
  let hash = 2166136261;
  for (let i = 0; i < sampleSignature.length; i += 1) {
    hash ^= sampleSignature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const fingerprint = `fp-${(hash >>> 0).toString(16)}`;
  return { headers, rows, sampleRows, delimiter, fingerprint };
};

export const parseNumberByLocale = (raw: string, decimal: "," | "."): number | null => {
  const value = clean(raw);
  if (!value) return null;
  const normalized = decimal === ","
    ? value.replace(/\./g, "").replace(/,/g, ".")
    : value.replace(/,/g, "");
  const parsed = Number(normalized.replace(/\s/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const headerIncludes = (headers: string[], candidates: string[]) => candidates.some((candidate) => headers.some((header) => normalize(header).includes(normalize(candidate))));

const pickHeader = (headers: string[], candidates: string[]) => headers.find((header) => candidates.some((candidate) => normalize(header).includes(normalize(candidate))));

export const detectMapping = (
  headers: string[],
  sampleRows: Record<string, string>[],
  delimiterHint?: ";" | "," | "\t",
): ImportMapping => {
  const lowerHeaders = headers.map((header) => normalize(header));
  const nordeaSignals = ["Affärsnr", "Transaktionstyp", "Avslutsdatum", "Antal/Nominellt"].filter((candidate) => lowerHeaders.includes(normalize(candidate))).length;
  const avanzaSignals = ["Datum", "Typ av transaktion", "Antal", "Pris", "Belopp"].filter((candidate) => lowerHeaders.includes(normalize(candidate))).length;
  const ibkrSignals = ["ClientAccountID", "Symbol", "Description", "TradeDate", "Quantity"].filter((candidate) => lowerHeaders.includes(normalize(candidate))).length;
  const degiroSignals = ["Datum", "Tid", "Produkt", "ISIN", "Börs"].filter((candidate) => lowerHeaders.includes(normalize(candidate))).length;

  const hasTxSignals = headerIncludes(headers, ["trade", "affärsnr", "transaktionstyp", "price", "kurs", "datum"]);
  const hasHoldingsSignals = headerIncludes(headers, ["avg", "genomsnitt", "shares", "antal", "quantity", "average cost"]);

  const kind: ImportKind = hasTxSignals ? "transactions" : hasHoldingsSignals ? "holdings" : "unknown";
  const broker_key: BrokerKey = nordeaSignals >= 3
    ? "nordea"
    : avanzaSignals >= 3
      ? "avanza"
      : ibkrSignals >= 3
        ? "interactive_brokers"
        : degiroSignals >= 3
          ? "degiro"
          : "unknown";

  const decimal: "," | "." = sampleRows.some((row) => Object.values(row).some((value) => /\d+,\d+/.test(value))) ? "," : ".";
  const date_parser: "sv_date" | "iso" | "en_text" = sampleRows.some((row) => Object.values(row).some((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))
    ? "iso"
    : sampleRows.some((row) => Object.values(row).some((value) => /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(value)))
      ? "sv_date"
      : "en_text";

  const columns: ImportMapping["columns"] = {
    trade_id: pickHeader(headers, ["affärsnr", "trade id", "id"]),
    trade_type: pickHeader(headers, ["transaktionstyp", "type"]),
    symbol: pickHeader(headers, ["ticker", "symbol", "kortnamn"]),
    name: pickHeader(headers, ["name", "namn", "instrument"]),
    isin: pickHeader(headers, ["isin"]),
    exchange: pickHeader(headers, ["marknad", "exchange", "börs"]),
    date: pickHeader(headers, ["datum", "avslutsdatum", "trade date", "tradedate", "date"]),
    quantity: pickHeader(headers, ["antal", "quantity", "shares", "aantal"]),
    price: pickHeader(headers, ["kurs", "price", "pris"]),
    currency: pickHeader(headers, ["valuta", "currency"]),
    avg_cost: pickHeader(headers, ["genomsnitt", "avg"]),
    fees: pickHeader(headers, ["courtage", "avgift", "fees"]),
    amount: pickHeader(headers, ["belopp", "amount", "total"]),
  };

  const questions: string[] = [];
  let confidence = 0.65;
  if (kind !== "unknown") confidence += 0.1;
  if (broker_key !== "unknown") confidence += 0.1;
  if (columns.isin || columns.name || columns.symbol) confidence += 0.08;
  if (columns.date) confidence += 0.07;

  if (!columns.isin && !columns.name && !columns.symbol) questions.push("Which column contains ISIN or asset name?");
  if (!columns.exchange && kind === "transactions") questions.push("Which exchange is this?");
  if (!columns.quantity) questions.push("Could not parse quantity column. Which column should be quantity?");

  const inferredDelimiter: ";" | "," | "\t" = delimiterHint ?? ",";

  return {
    kind,
    broker_key,
    delimiter: inferredDelimiter,
    decimal,
    date_parser,
    columns,
    transforms: {
      symbol_cleaning_rules: ["trim", "uppercase"],
      numeric_parse_rules: [decimal === "," ? "comma_decimal" : "dot_decimal"],
      exchange_map_rules: EXCHANGE_RULES,
    },
    confidence: Math.min(1, confidence),
    questions,
  };
};

export const mapExchangeToPriceSymbol = (symbolRaw: string | null | undefined, exchangeRaw: string | null | undefined) => {
  const symbol = clean(String(symbolRaw || "")).toUpperCase();
  if (!symbol) return { exchange_code: null, price_symbol: null };

  const exchangeKey = normalize(String(exchangeRaw || ""));
  const mapped = EXCHANGE_RULES[exchangeKey];
  if (mapped) return { exchange_code: mapped.exchange_code, price_symbol: `${symbol}:${mapped.exchange_code}` };
  if (exchangeKey === "tsx") return { exchange_code: "TSX", price_symbol: `${symbol}:TSX` };
  if (exchangeKey === "tsxv") return { exchange_code: "TSXV", price_symbol: `${symbol}:TSXV` };
  const exchangeCode = exchangeKey ? exchangeKey.toUpperCase() : null;
  return { exchange_code: exchangeCode, price_symbol: exchangeCode ? `${symbol}:${exchangeCode}` : symbol };
};


export const recomputeAvgCost = (transactions: Array<{ trade_type: string; quantity: number; price: number; fees?: number }>) => {
  let quantity = 0;
  let costBasis = 0;
  for (const tx of transactions) {
    const qty = Math.max(0, Number(tx.quantity || 0));
    const price = Number(tx.price || 0);
    const fees = Number(tx.fees || 0);
    if (tx.trade_type === "buy") {
      quantity += qty;
      costBasis += qty * price + fees;
    } else if (tx.trade_type === "sell" && quantity > 0) {
      const avg = costBasis / quantity;
      quantity = Math.max(0, quantity - qty);
      costBasis = Math.max(0, costBasis - qty * avg);
    }
  }
  return { quantity, avg_cost: quantity > 0 ? costBasis / quantity : 0 };
};

export interface ImportExecutionSummary {
  inserted: number;
  skipped: number;
  fallback: number;
}

const normalizeForImport = (value: unknown) => String(value ?? "").trim();

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(/\.(?=.*[,])/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureAsset(isin: string | null, name: string | null, identifier: string) {
  if (isin) {
    const { data: byIsin, error: byIsinError } = await supabase
      .from("assets")
      .select("id")
      .eq("isin", isin)
      .limit(1)
      .maybeSingle();
    if (byIsinError) throw byIsinError;
    if (byIsin?.id) return String(byIsin.id);
  }

  const { data: bySymbol, error: bySymbolError } = await supabase
    .from("assets")
    .select("id")
    .eq("symbol", identifier)
    .limit(1)
    .maybeSingle();
  if (bySymbolError) throw bySymbolError;
  if (bySymbol?.id) return String(bySymbol.id);

  const { data: inserted, error: insertError } = await supabase
    .from("assets")
    .insert({
      symbol: identifier,
      isin: isin || null,
      name: name || identifier,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return String(inserted.id);
}

export async function importHoldingsFromXlsx(
  portfolioId: string,
  fileData: ArrayBuffer
): Promise<ImportExecutionSummary> {
  const workbook = XLSX.read(fileData, { type: "array" });
  const sheet = workbook.Sheets["Holdings"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { inserted: 0, skipped: 0, fallback: 0 };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  let skipped = 0;
  let inserted = 0;
  let fallback = 0;

  const isCashName = (value: string) => {
    const v = value.toLowerCase();
    return v.includes("cash") || v.includes("likvid") || v.includes("konto");
  };

  const read = (row: Record<string, unknown>, aliases: string[]) => {
    for (const [key, value] of Object.entries(row)) {
      const normalized = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (aliases.some((alias) => normalized.includes(alias))) {
        return normalizeForImport(value);
      }
    }
    return "";
  };

  for (const row of rows) {
    try {
      const isin = read(row, ["isin"]).toUpperCase() || null;
      const name = read(row, ["name", "namn", "instrument", "asset"]);
      const quantity = parseNumber(read(row, ["holding", "quantity", "antal", "shares"]));
      const price = parseNumber(read(row, ["price", "kurs", "avgcost", "averagecost"]));
      const currency = read(row, ["currency", "valuta"]).toUpperCase() || null;

      if ((!isin && !name) || !quantity || isCashName(name)) {
        skipped += 1;
        continue;
      }

      const identifier = buildAssetIdentifier(isin, name);
      if (!isin) fallback += 1;

      const assetId = await ensureAsset(isin, name, identifier);

      const { error } = await supabase
        .from("holdings")
        .upsert(
          {
            portfolio_id: portfolioId,
            asset_id: assetId,
            quantity,
            avg_cost: price ?? 0,
            cost_currency: currency || "SEK",
          },
          { onConflict: "portfolio_id,asset_id" }
        );
      if (error) throw error;
      inserted += 1;
    } catch (error) {
      console.error("Holdings row import error:", error);
      skipped += 1;
    }
  }

  const result = { inserted, skipped, fallback };
  console.log("Import summary:", {
    inserted,
    skipped,
    fallback,
  });
  return result;
}

export async function runImportPipeline(
  portfolioId: string,
  file: File,
  fileData: ArrayBuffer | string
): Promise<ImportExecutionSummary> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) {
    const mod = await import("@/lib/transaction-import");
    return mod.importAvanzaTransactionsCsv(portfolioId, String(fileData));
  }

  if (name.endsWith(".xlsx")) {
    return importHoldingsFromXlsx(portfolioId, fileData as ArrayBuffer);
  }

  return { inserted: 0, skipped: 0, fallback: 0 };
}
