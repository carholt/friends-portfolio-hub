import { describe, expect, it, vi } from "vitest";
import { tryClaimQueuedReport } from "../../supabase/functions/company-ai-report/claim";

type FakeRow = { id: string; status: string; worker_id: string | null };

class FakeAdminClient {
  constructor(private row: FakeRow) {}

  from(table: string) {
    if (table !== "company_ai_reports") throw new Error("unexpected table");
    const row = this.row;

    return {
      update(payload: Record<string, unknown>) {
        const filters: Record<string, unknown> = {};

        const builder = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          select() {
            return builder;
          },
          async maybeSingle() {
            if (filters.id !== row.id || filters.status !== row.status) {
              return { data: null, error: null };
            }
            row.status = String(payload.status ?? row.status);
            row.worker_id = (payload.worker_id as string) ?? row.worker_id;
            return { data: { id: row.id }, error: null };
          },
        };

        return builder;
      },
    };
  }
}

describe("tryClaimQueuedReport", () => {
  it("allows only one concurrent claim and one OpenAI invocation", async () => {
    const row: FakeRow = { id: "r1", status: "queued", worker_id: null };
    const admin = new FakeAdminClient(row);
    const openAiRequest = vi.fn(async () => ({ ok: true }));

    const processOnce = async (workerId: string) => {
      const acquired = await tryClaimQueuedReport({
        adminClient: admin as unknown as Parameters<typeof tryClaimQueuedReport>[0]["adminClient"],
        reportId: "r1",
        workerId,
        nowIso: new Date().toISOString(),
      });

      if (!acquired) return "already_processing_or_completed";
      await openAiRequest();
      return "processed";
    };

    const [first, second] = await Promise.all([processOnce("w1"), processOnce("w2")]);

    expect([first, second].sort()).toEqual(["already_processing_or_completed", "processed"]);
    expect(openAiRequest).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("running");
    expect(row.worker_id).toBe("w1");
  });
});
