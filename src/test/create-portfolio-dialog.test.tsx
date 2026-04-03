import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import CreatePortfolioDialog from "@/components/CreatePortfolioDialog";

const createdRows: Record<string, unknown>[] = [];
const toastSuccess = vi.fn();
const toastError = vi.fn();
const logAuditAction = vi.fn().mockResolvedValue(undefined);

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/lib/audit", () => ({
  logAuditAction: (...args: unknown[]) => logAuditAction(...args),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "group_members") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [] }),
          }),
        };
      }

      if (table === "portfolios") {
        return {
          insert: (payload: Record<string, unknown>) => {
            const row = { ...payload, id: `p-${createdRows.length + 1}` };
            createdRows.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: row.id }, error: null }),
              }),
            };
          },
        };
      }

      return {
        select: () => ({ eq: async () => ({ data: [] }) }),
      };
    },
  },
}));

describe("CreatePortfolioDialog", () => {
  beforeEach(() => {
    createdRows.length = 0;
    toastSuccess.mockClear();
    toastError.mockClear();
    logAuditAction.mockClear();
  });

  it("returns success and inserts a row into public.portfolios on submit", async () => {
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();

    render(<CreatePortfolioDialog open={true} onOpenChange={onOpenChange} onCreated={onCreated} />);

    fireEvent.change(screen.getByPlaceholderText("Min guldportfölj"), { target: { value: "Testportfölj" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa portfölj" }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Portfölj skapad!");
    });

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      owner_user_id: "user-1",
      name: "Testportfölj",
      broker: "manual",
      broker_notes: null,
    });
    expect(logAuditAction).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalled();
  });
});
