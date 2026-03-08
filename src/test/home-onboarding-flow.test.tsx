import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import HomePage from "@/pages/Home";

const mockUseQuery = vi.fn();
const mockUseAppBootstrap = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/useAppBootstrap", () => ({
  useAppBootstrap: () => mockUseAppBootstrap(),
}));

vi.mock("@/hooks/useSessionGuard", () => ({
  useSessionGuard: () => undefined,
}));

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/CreatePortfolioDialog", () => ({
  default: () => null,
}));

describe("home onboarding and zero-portfolio behavior", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { values: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseAppBootstrap.mockReturnValue({
      data: {
        profileLoaded: true,
        profileError: null,
        profile: { onboarding_completed: false },
        onboardingCompleted: false,
        portfolioCount: 0,
        portfolios: [],
        portfolioError: null,
      },
      error: null,
    });
  });

  it("user with 0 portfolios can load the app and sees empty state", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByText("Your summary")).toBeInTheDocument();
    expect(screen.getByText("No portfolios yet")).toBeInTheDocument();
  });

  it("shows onboarding when onboarding_completed=false and allows closing", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByText("Welcome")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("hides onboarding when onboarding_completed=true", () => {
    mockUseAppBootstrap.mockReturnValueOnce({
      data: {
        profileLoaded: true,
        profileError: null,
        profile: { onboarding_completed: true },
        onboardingCompleted: true,
        portfolioCount: 0,
        portfolios: [],
        portfolioError: null,
      },
      error: null,
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("portfolio query failure in bootstrap still allows app to load", () => {
    mockUseAppBootstrap.mockReturnValueOnce({
      data: {
        profileLoaded: true,
        profileError: null,
        profile: { onboarding_completed: true },
        onboardingCompleted: true,
        portfolioCount: 0,
        portfolios: [],
        portfolioError: "failed to query portfolios",
      },
      error: null,
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByText("Your summary")).toBeInTheDocument();
    expect(screen.getByText("No portfolios yet")).toBeInTheDocument();
  });
});
