import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HoldingsTable from "@/components/portfolio/HoldingsTable";

const holdings = [
  { id: "1", quantity: 10, avg_cost: 100, bucket: "Growth", asset: { symbol: "AAA", name: "Alpha" }, latest_price: 120 },
  { id: "2", quantity: 1, avg_cost: 400, bucket: "Income", asset: { symbol: "ZZZ", name: "Zulu" }, latest_price: 200 },
];

describe("HoldingsTable", () => {
  it("supports search and default value sorting", () => {
    render(
      <MemoryRouter>
        <HoldingsTable holdings={holdings} baseCurrency="USD" onResolve={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    );

    const symbols = screen.getAllByRole("link").map((el) => el.textContent);
    expect(symbols[0]).toBe("AAA");

    fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "zzz" } });
    expect(screen.getByText("ZZZ")).toBeInTheDocument();
    expect(screen.queryByText("AAA")).not.toBeInTheDocument();
  });

  it("filters by concentration risk", () => {
    render(
      <MemoryRouter>
        <HoldingsTable holdings={holdings} baseCurrency="USD" onResolve={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("All risk"));
    fireEvent.click(screen.getByText("High concentration"));
    expect(screen.getByText("AAA")).toBeInTheDocument();
    expect(screen.queryByText("ZZZ")).not.toBeInTheDocument();
  });
});
