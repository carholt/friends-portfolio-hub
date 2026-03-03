import * as XLSX from "xlsx";

const FX_RATES: Record<string, Record<string, number>> = {
  USD: { SEK: 10.5, EUR: 0.92, USD: 1 },
  SEK: { USD: 0.095, EUR: 0.088, SEK: 1 },
  EUR: { USD: 1.09, SEK: 11.4, EUR: 1 },
};

const ALLOWED_ASSET_TYPES = new Set(["stock", "etf", "fund", "metal", "crypto", "other"]);

export interface ParsedImportRow {
  symbol: string;
  name: string;
  asset_type: string;
  exchange: string;
  quantity: number;
  avg_cost: number;
  cost_currency: string;
  metadata_json?: Record<string, string>;
  account_key?: string;
  valid: boolean;
  errors: string[];
}

export interface ParsedSpreadsheetImport {
  holdings: Array<Record<string, unknown>>;
  detectedNordea: boolean;
  baseCurrency?: string;
  nordeaAccounts?: NordeaAccountGroup[];
}

export interface NordeaAccountGroup {
  accountKey: string;
  accountName: string;
  holdingsCount: number;
  marketValueBase: number | null;
  baseCurrency: string;
}

export function convertCurrency(amount: number, from: string, to: string): { value: number; converted: boolean } {
  if (from === to) return { value: amount, converted: true };
  const rate = FX_RATES[from]?.[to];
  if (!rate) return { value: amount, converted: false };
  return { value: amount * rate, converted: true };
}

export function exportToCSV(portfolioName: string, holdings: any[]): void {
  const exportedAt = new Date().toISOString();
  const headers = ["exported_at", "portfolio_name", "symbol", "asset_type", "exchange", "quantity", "avg_cost", "cost_currency"];
  const rows = holdings.map((h) => [
    exportedAt,
    portfolioName,
    h.asset?.symbol ?? "",
    h.asset?.asset_type ?? "",
    h.asset?.exchange ?? "",
    h.quantity,
    h.avg_cost,
    h.cost_currency,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
  downloadFile(csv, `${portfolioName}.csv`, "text/csv");
}

export function exportToJSON(portfolio: any, holdings: any[]): void {
  const data = {
    exported_at: new Date().toISOString(),
    portfolio: {
      name: portfolio.name,
      description: portfolio.description,
      base_currency: portfolio.base_currency,
      visibility: portfolio.visibility,
    },
    holdings: holdings.map((h) => ({
      symbol: h.asset?.symbol ?? "",
      name: h.asset?.name ?? "",
      asset_type: h.asset?.asset_type ?? "",
      exchange: h.asset?.exchange ?? "",
      currency: h.asset?.currency ?? "",
      quantity: h.quantity,
      avg_cost: h.avg_cost,
      cost_currency: h.cost_currency,
    })),
  };

  downloadFile(JSON.stringify(data, null, 2), `${portfolio.name}.json`, "application/json");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || "").replace(/"/g, "").trim();
    });
    return row;
  });
}

export function parseJSONImport(text: string): { portfolio?: any; holdings: any[] } {
  const data = JSON.parse(text);
  if (data.holdings && Array.isArray(data.holdings)) {
    return { portfolio: data.portfolio, holdings: data.holdings };
  }
  return { holdings: [] };
}

function normalizeNordeaRow(row: Record<string, unknown>) {
  const isin = String(row.ISIN ?? "").trim();
  const quantity = Number(row.HOLDINGS);
  const avgCost = Number(row["Average purchase price"]);
  const baseCurrency = String(row["Base currency"] ?? "").trim().toUpperCase() || "SEK";
  const price = Number(row.PRICE);
  const accountKey = String(row.AccountKey ?? "").trim();

  return {
    symbol: isin,
    name: String(row.NAME ?? "").trim(),
    asset_type: "stock",
    quantity,
    avg_cost: Number.isFinite(avgCost) && avgCost >= 0 ? avgCost : 0,
    cost_currency: String(row.CURRENCY ?? "").trim().toUpperCase() || baseCurrency || "SEK",
    account_key: accountKey,
    metadata_json: {
      isin,
      ...(String(row.MIC ?? "").trim() ? { mic: String(row.MIC ?? "").trim() } : {}),
      source: "nordea",
    },
    _nordea_price: Number.isFinite(price) ? price : null,
    _nordea_base_currency: baseCurrency,
  };
}

export function groupNordeaHoldingsByAccount(rows: Array<Record<string, unknown>>): NordeaAccountGroup[] {
  const byAccount = new Map<string, NordeaAccountGroup>();

  for (const row of rows) {
    const accountKey = String(row.AccountKey ?? "").trim();
    if (!accountKey) continue;

    const current = byAccount.get(accountKey) ?? {
      accountKey,
      accountName: String(row.Account ?? "").trim() || "Unnamed account",
      holdingsCount: 0,
      marketValueBase: 0,
      baseCurrency: String(row["Base currency"] ?? "").trim().toUpperCase() || "SEK",
    };

    current.holdingsCount += 1;
    const holdings = Number(row.HOLDINGS);
    const price = Number(row.PRICE);
    if (Number.isFinite(holdings) && Number.isFinite(price)) {
      current.marketValueBase = (current.marketValueBase ?? 0) + holdings * price;
    }

    byAccount.set(accountKey, current);
  }

  return Array.from(byAccount.values()).map((group) => ({
    ...group,
    marketValueBase: Number.isFinite(group.marketValueBase ?? NaN) ? group.marketValueBase : null,
  }));
}

export function detectNordeaHoldingsFormat(workbook: XLSX.WorkBook): boolean {
  const sheet = workbook.Sheets.Holdings;
  if (!sheet) return false;
  const rows = XLSX.utils.sheet_to_json<Array<string | undefined>>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  const headerRow = rows[1] ?? [];
  return headerRow.some((cell) => String(cell).trim() === "ISIN")
    && headerRow.some((cell) => String(cell).trim() === "AccountKey");
}

export function parseExcelImport(fileData: ArrayBuffer): ParsedSpreadsheetImport {
  const workbook = XLSX.read(fileData, { type: "array" });
  const detectedNordea = detectNordeaHoldingsFormat(workbook);

  if (detectedNordea) {
    const sheet = workbook.Sheets.Holdings;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      range: 1,
      defval: null,
      raw: true,
    });

    const filteredRows = rows
      .filter((row) => String(row.Type ?? "").trim() === "Custody")
      .filter((row) => row.ISIN !== null && String(row.ISIN ?? "").trim() !== "")
      .filter((row) => Number.isFinite(Number(row.HOLDINGS)) && Number(row.HOLDINGS) > 0)
      .filter((row) => String(row.NAME ?? "").trim() !== "")
      .map(normalizeNordeaRow);

    const nordeaAccounts = groupNordeaHoldingsByAccount(rows
      .filter((row) => String(row.Type ?? "").trim() === "Custody")
      .filter((row) => row.ISIN !== null && String(row.ISIN ?? "").trim() !== "")
      .filter((row) => Number.isFinite(Number(row.HOLDINGS)) && Number(row.HOLDINGS) > 0)
      .filter((row) => String(row.NAME ?? "").trim() !== ""));

    const firstBaseCurrency = rows
      .map((row) => String(row["Base currency"] ?? "").trim().toUpperCase())
      .find((currency) => /^[A-Z]{3}$/.test(currency));

    return {
      holdings: filteredRows,
      detectedNordea: true,
      baseCurrency: firstBaseCurrency,
      nordeaAccounts,
    };
  }

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const holdings = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: null });
  return { holdings, detectedNordea: false };
}

export function validateImportRows(rows: any[]): ParsedImportRow[] {
  return rows.map((r) => {
    const symbol = String(r.symbol || "").toUpperCase().trim();
    const name = String(r.name || r.symbol || "").trim();
    const assetType = String(r.asset_type || "stock").toLowerCase().trim();
    const exchange = String(r.exchange || "").trim();
    const quantity = Number(r.quantity);
    const avgCost = r.avg_cost === undefined || r.avg_cost === null || String(r.avg_cost).trim() === "" ? 0 : Number(r.avg_cost);
    const costCurrency = String(r.cost_currency || "USD").toUpperCase().trim();
    const metadataJson = typeof r.metadata_json === "object" && r.metadata_json !== null ? r.metadata_json : undefined;
    const errors: string[] = [];

    if (!symbol || !/^[A-Z0-9.\-/]{1,20}$/.test(symbol)) {
      errors.push("Ogiltig symbol");
    }
    if (!ALLOWED_ASSET_TYPES.has(assetType)) {
      errors.push("Ogiltig tillgångstyp");
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push("Antal måste vara > 0");
    }
    if (!Number.isFinite(avgCost) || avgCost < 0) {
      errors.push("Snittpris måste vara >= 0");
    }
    if (!/^[A-Z]{3}$/.test(costCurrency)) {
      errors.push("Valuta måste vara ISO-4217 (3 bokstäver)");
    }

    return {
      symbol,
      name,
      asset_type: assetType,
      exchange,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      avg_cost: Number.isFinite(avgCost) ? avgCost : 0,
      cost_currency: costCurrency,
      metadata_json: metadataJson,
      account_key: typeof r.account_key === "string" ? r.account_key : undefined,
      valid: errors.length === 0,
      errors,
    };
  });
}
