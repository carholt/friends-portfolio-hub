export interface TwelveDataStockCandidate {
  symbol: string;
  exchange?: string | null;
}

export interface SymbolRecommendation {
  symbol: string;
  pricingSymbol: string;
  exchange?: string;
  exchangeRequired: boolean;
}

const EXCHANGE_PRIORITY = [
  "NASDAQ",
  "NYSE",
  "AMEX",
  "ARCA",
  "TSX",
  "TSXV",
  "LSE",
  "XETRA",
  "EURONEXT",
];

const normalizeExchange = (exchange?: string | null): string | null => {
  if (!exchange) {
    return null;
  }

  const normalized = exchange.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
};

const pickExchange = (exchanges: string[]): string => {
  const byPriority = [...exchanges].sort((left, right) => {
    const leftIndex = EXCHANGE_PRIORITY.indexOf(left);
    const rightIndex = EXCHANGE_PRIORITY.indexOf(right);

    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }

    if (leftIndex === -1) {
      return 1;
    }

    if (rightIndex === -1) {
      return -1;
    }

    return leftIndex - rightIndex;
  });

  return byPriority[0];
};

export const recommendPricingSymbol = (
  requestedTicker: string,
  candidates: TwelveDataStockCandidate[],
): SymbolRecommendation | null => {
  const cleanedTicker = requestedTicker.trim().toUpperCase();

  if (!cleanedTicker) {
    return null;
  }

  const exactMatches = candidates.filter((candidate) => {
    return candidate.symbol.trim().toUpperCase() === cleanedTicker;
  });

  if (exactMatches.length === 0) {
    return null;
  }

  const exchanges = [...new Set(exactMatches.map((item) => normalizeExchange(item.exchange)).filter(Boolean))] as string[];

  if (exchanges.length <= 1) {
    return {
      symbol: cleanedTicker,
      pricingSymbol: cleanedTicker,
      exchange: exchanges[0],
      exchangeRequired: false,
    };
  }

  const preferredExchange = pickExchange(exchanges);

  return {
    symbol: cleanedTicker,
    pricingSymbol: `${cleanedTicker}:${preferredExchange}`,
    exchange: preferredExchange,
    exchangeRequired: true,
  };
};
