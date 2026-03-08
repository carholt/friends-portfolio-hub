import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";

let mockedQuery: any;

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mockedQuery,
}));

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ImportDialog", () => ({ default: () => null }));
vi.mock("@/components/TransactionImportDialog", () => ({ default: () => null }));
vi.mock("@/components/ResolveTickerDialog", () => ({ default: () => null }));
vi.mock("@/components/TradeModal", () => ({ default: () => null }));

const baseData = {
  portfolio: { id: "p1", name: "Main", base_currency: "USD", visibility: "private", owner_user_id: "u1", broker_notes: "Nordea" },
  currentUserId: "u1",
  holdings: [{ id: "h1", quantity: 10, avg_cost: 100, cost_currency: "USD", bucket: "Growth", asset_id: "a1", asset: { id: "a1", symbol: "MSFT", name: "Microsoft" }, latest_price: 110 }],
  transactions: [],
  valuation: { total_value: 1100, as_of_date: "2026-01-01" },
  latestPrice: new Map([["a1", 110]]),
};

describe("Portfolio page redesign", () => {
  beforeEach(() => {
    mockedQuery = { isLoading: false, error: null, refetch: vi.fn(), data: baseData };
  });

  it("renders premium sections with full data", async () => {
    const { default: PortfolioDetail } = await import("@/pages/PortfolioDetail");
    render(<MemoryRouter initialEntries={["/portfolio/p1"]}><Routes><Route path="/portfolio/:id" element={<PortfolioDetail />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByText("Compare")).toBeInTheDocument();
    expect(screen.getByText("Delete portfolio")).toBeInTheDocument();
  });

  it("renders empty-state UX when portfolio has no holdings", async () => {
    mockedQuery.data = { ...baseData, holdings: [] };
    const { default: PortfolioDetail } = await import("@/pages/PortfolioDetail");
    render(<MemoryRouter initialEntries={["/portfolio/p1"]}><Routes><Route path="/portfolio/:id" element={<PortfolioDetail />} /></Routes></MemoryRouter>);
    expect(screen.getByText("No holdings in this portfolio yet")).toBeInTheDocument();
  });

  it("shows compare CTA", async () => {
    const { default: PortfolioDetail } = await import("@/pages/PortfolioDetail");
    render(<MemoryRouter initialEntries={["/portfolio/p1"]}><Routes><Route path="/portfolio/:id" element={<PortfolioDetail />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("renders AI insights safely with partial data", async () => {
    mockedQuery.data = { ...baseData, holdings: [{ ...baseData.holdings[0], asset: { symbol: "MSFT" } }] };
    const { default: PortfolioDetail } = await import("@/pages/PortfolioDetail");
    render(<MemoryRouter initialEntries={["/portfolio/p1"]}><Routes><Route path="/portfolio/:id" element={<PortfolioDetail />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Analysis")).toBeInTheDocument();
  });
});
