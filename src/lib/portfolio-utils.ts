import { supabase } from "@/integrations/supabase/client";

// Simple FX rates fallback - in production, fetch from Twelve Data or similar
const FX_RATES: Record<string, Record<string, number>> = {
  USD: { SEK: 10.5, EUR: 0.92, USD: 1 },
  SEK: { USD: 0.095, EUR: 0.088, SEK: 1 },
  EUR: { USD: 1.09, SEK: 11.4, EUR: 1 },
};

export function convertCurrency(amount: number, from: string, to: string): { value: number; converted: boolean } {
  if (from === to) return { value: amount, converted: true };
  const rate = FX_RATES[from]?.[to];
  if (!rate) return { value: amount, converted: false };
  return { value: amount * rate, converted: true };
}

export function formatCurrency(value: number, currency: string): string {
  return value.toLocaleString("sv-SE", { maximumFractionDigits: 0 }) + " " + currency;
}

// Export portfolio to CSV
export function exportToCSV(portfolioName: string, holdings: any[]): void {
  const headers = ["portfolio_name", "symbol", "asset_type", "exchange", "quantity", "avg_cost", "cost_currency"];
  const rows = holdings.map(h => [
    portfolioName,
    h.asset?.symbol ?? "",
    h.asset?.asset_type ?? "",
    h.asset?.exchange ?? "",
    h.quantity,
    h.avg_cost,
    h.cost_currency,
  ]);

  const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
  downloadFile(csv, `${portfolioName}.csv`, "text/csv");
}

// Export portfolio to JSON
export function exportToJSON(portfolio: any, holdings: any[]): void {
  const data = {
    portfolio: {
      name: portfolio.name,
      description: portfolio.description,
      base_currency: portfolio.base_currency,
      visibility: portfolio.visibility,
    },
    holdings: holdings.map(h => ({
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

// Parse CSV import
export function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim());
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || "").replace(/"/g, "").trim();
    });
    return row;
  });
}

// Parse JSON import
export function parseJSONImport(text: string): { portfolio?: any; holdings: any[] } {
  const data = JSON.parse(text);
  if (data.holdings && Array.isArray(data.holdings)) {
    return { portfolio: data.portfolio, holdings: data.holdings };
  }
  return { holdings: [] };
}

// Get period start date
export function getPeriodStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case "1M": return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3M": return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "YTD": return new Date(now.getFullYear(), 0, 1);
    case "1Y": return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "ALL": return new Date(2000, 0, 1);
    default: return new Date(2000, 0, 1);
  }
}
