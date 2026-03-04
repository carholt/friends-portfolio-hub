import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  recommendPricingSymbol,
  type TwelveDataStockCandidate,
} from "../src/lib/twelvedataSymbol.ts";

type ResolutionStatus = "resolved" | "invalid_symbol";
type PriceStatus = "ok" | "plan_gated" | "invalid_symbol" | "rate_limited";

interface ResolutionResult {
  input: string;
  status: ResolutionStatus;
  pricingSymbol?: string;
  exchangeRequired?: boolean;
  exchange?: string;
  reason?: string;
}

interface PriceResult {
  symbol: string;
  status: PriceStatus;
  price?: string;
  message?: string;
}

const TWELVEDATA_BASE_URL = "https://api.twelvedata.com";
const MAX_SYMBOLS_PER_MINUTE = 8;
const RETRY_BACKOFF_MS = [15000, 30000, 60000];

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const isPlanGatedMessage = (message: string): boolean => {
  return /grow|pro|upgrade|subscription|plan/i.test(message);
};

const isRateLimitMessage = (message: string): boolean => {
  return /rate limit|too many requests|credits exceeded|api credits/i.test(message);
};

const buildUrl = (endpoint: string, query: Record<string, string>): URL => {
  const url = new URL(endpoint, TWELVEDATA_BASE_URL);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return url;
};

const fetchJson = async (url: URL): Promise<unknown> => {
  const response = await fetch(url);
  return response.json();
};

const normalizeStocksResponse = (payload: unknown): TwelveDataStockCandidate[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter((entry): entry is { symbol?: unknown; exchange?: unknown } => !!entry && typeof entry === "object")
    .map((entry) => ({
      symbol: typeof entry.symbol === "string" ? entry.symbol : "",
      exchange: typeof entry.exchange === "string" ? entry.exchange : null,
    }))
    .filter((entry) => entry.symbol.length > 0);
};

const resolveTicker = async (ticker: string, apiKey: string): Promise<ResolutionResult> => {
  const url = buildUrl("/stocks", {
    symbol: ticker,
    apikey: apiKey,
  });

  const payload = await fetchJson(url);
  const recommendation = recommendPricingSymbol(ticker, normalizeStocksResponse(payload));

  if (!recommendation) {
    return {
      input: ticker,
      status: "invalid_symbol",
      reason: "No exact match returned by /stocks",
    };
  }

  return {
    input: ticker,
    status: "resolved",
    pricingSymbol: recommendation.pricingSymbol,
    exchangeRequired: recommendation.exchangeRequired,
    exchange: recommendation.exchange,
  };
};

const classifyPriceEntry = (symbol: string, entry: unknown): PriceResult => {
  if (!entry || typeof entry !== "object") {
    return {
      symbol,
      status: "invalid_symbol",
      message: "No payload returned",
    };
  }

  const asRecord = entry as Record<string, unknown>;

  if (typeof asRecord.price === "string" || typeof asRecord.price === "number") {
    return {
      symbol,
      status: "ok",
      price: String(asRecord.price),
    };
  }

  const message = typeof asRecord.message === "string" ? asRecord.message : "Unknown error";

  if (isRateLimitMessage(message)) {
    return {
      symbol,
      status: "rate_limited",
      message,
    };
  }

  if (isPlanGatedMessage(message)) {
    return {
      symbol,
      status: "plan_gated",
      message,
    };
  }

  return {
    symbol,
    status: "invalid_symbol",
    message,
  };
};

const fetchPricesWithRetry = async (
  symbols: string[],
  apiKey: string,
): Promise<Record<string, PriceResult>> => {
  const querySymbols = symbols.join(",");

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    const url = buildUrl("/price", {
      symbol: querySymbols,
      apikey: apiKey,
    });

    const payload = await fetchJson(url);

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const recordPayload = payload as Record<string, unknown>;
      const topLevelMessage =
        typeof recordPayload.message === "string" ? recordPayload.message : null;

      if (topLevelMessage && isRateLimitMessage(topLevelMessage)) {
        if (attempt < RETRY_BACKOFF_MS.length) {
          const delay = RETRY_BACKOFF_MS[attempt];
          console.log(
            `rate_limited: batch ${querySymbols} retrying in ${(delay / 1000).toFixed(0)}s`,
          );
          await sleep(delay);
          continue;
        }

        return Object.fromEntries(
          symbols.map((symbol) => [
            symbol,
            {
              symbol,
              status: "rate_limited",
              message: topLevelMessage,
            } satisfies PriceResult,
          ]),
        );
      }

      return Object.fromEntries(
        symbols.map((symbol) => [symbol, classifyPriceEntry(symbol, recordPayload[symbol] ?? recordPayload)]),
      );
    }

    return Object.fromEntries(
      symbols.map((symbol) => [
        symbol,
        {
          symbol,
          status: "invalid_symbol",
          message: "Unexpected /price response payload",
        } satisfies PriceResult,
      ]),
    );
  }

  return {};
};

const loadTickers = async (filePath: string): Promise<string[]> => {
  const fullPath = path.resolve(process.cwd(), filePath);
  const raw = await readFile(fullPath, "utf8");

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.toUpperCase());
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const printSummary = (resolution: ResolutionResult[], prices: PriceResult[]): void => {
  console.log("\n=== Symbol Resolution ===");
  for (const row of resolution) {
    if (row.status === "resolved") {
      console.log(
        `resolved: ${row.input} -> ${row.pricingSymbol}${
          row.exchangeRequired ? " (exchange required)" : ""
        }`,
      );
    } else {
      console.log(`invalid_symbol: ${row.input} (${row.reason})`);
    }
  }

  console.log("\n=== Price Smoke Test ===");
  for (const result of prices) {
    if (result.status === "ok") {
      console.log(`ok: ${result.symbol} -> ${result.price}`);
      continue;
    }

    console.log(`${result.status}: ${result.symbol} (${result.message ?? "no message"})`);
  }

  const counters = prices.reduce(
    (accumulator, current) => {
      accumulator[current.status] += 1;
      return accumulator;
    },
    {
      ok: 0,
      plan_gated: 0,
      invalid_symbol: 0,
      rate_limited: 0,
    } as Record<PriceStatus, number>,
  );

  console.log("\n=== Totals ===");
  console.log(`ok=${counters.ok}`);
  console.log(`plan_gated=${counters.plan_gated}`);
  console.log(`invalid_symbol=${counters.invalid_symbol}`);
  console.log(`rate_limited=${counters.rate_limited}`);
};

const main = async (): Promise<void> => {
  const apiKey = process.env.TWELVEDATA_API_KEY;

  if (!apiKey) {
    throw new Error("Missing TWELVEDATA_API_KEY environment variable.");
  }

  const inputPath = process.argv[2] ?? "tickers.txt";
  const tickers = await loadTickers(inputPath);

  if (tickers.length === 0) {
    console.log("No tickers provided.");
    return;
  }

  console.log(`Loaded ${tickers.length} tickers from ${inputPath}`);

  const resolutionResults: ResolutionResult[] = [];
  for (const ticker of tickers) {
    resolutionResults.push(await resolveTicker(ticker, apiKey));
  }

  const pricingSymbols = resolutionResults
    .filter((item): item is ResolutionResult & { pricingSymbol: string } => item.status === "resolved")
    .map((item) => item.pricingSymbol);

  const priceResultsBySymbol = new Map<string, PriceResult>();
  const pricingChunks = chunk(pricingSymbols, MAX_SYMBOLS_PER_MINUTE);

  for (let index = 0; index < pricingChunks.length; index += 1) {
    const symbols = pricingChunks[index];
    const startedAt = Date.now();
    const batchResult = await fetchPricesWithRetry(symbols, apiKey);

    for (const symbol of symbols) {
      priceResultsBySymbol.set(symbol, batchResult[symbol]);
    }

    if (index < pricingChunks.length - 1) {
      const elapsed = Date.now() - startedAt;
      const waitMs = Math.max(0, 60000 - elapsed);

      if (waitMs > 0) {
        console.log(`Throttling for ${(waitMs / 1000).toFixed(0)}s to respect 8 symbols/minute.`);
        await sleep(waitMs);
      }
    }
  }

  const priceResults: PriceResult[] = pricingSymbols.map((symbol) => {
    return (
      priceResultsBySymbol.get(symbol) ?? {
        symbol,
        status: "invalid_symbol",
        message: "No result returned",
      }
    );
  });

  printSummary(resolutionResults, priceResults);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`validate:twelvedata failed: ${message}`);
  process.exitCode = 1;
});
