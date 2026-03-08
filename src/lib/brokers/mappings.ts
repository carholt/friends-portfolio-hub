export type BrokerType = "manual" | "avanza" | "nordea" | "interactive_brokers" | "degiro" | "vera_cash" | "binance";

export interface BrokerHoldingRow {
  symbol: string;
  quantity: number;
  avg_cost?: number;
  cost_currency?: string;
}

// TODO: Add broker-specific parsers once sample export files are available.
export function mapBrokerRows(_broker: BrokerType, _input: unknown): BrokerHoldingRow[] {
  return [];
}
