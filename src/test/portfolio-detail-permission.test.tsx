import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isLoading: false, error: new Error("permission denied"), refetch: vi.fn() }),
}));

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("Portfolio detail permission-safe UX", () => {
  it("shows friendly no-access message", { timeout: 15000 }, async () => {
    const { default: PortfolioDetail } = await import("@/pages/PortfolioDetail");

    render(
      <MemoryRouter initialEntries={["/portfolio/p1"]}>
        <Routes>
          <Route path="/portfolio/:id" element={<PortfolioDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("You no longer have access")).toBeInTheDocument();
  });
});
