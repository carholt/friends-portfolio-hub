import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectHoldingsImportIssue } from "@/lib/import-guards";

describe("holdings import guardrails", () => {
  it("flags transaction export uploads", () => {
    const fixture = readFileSync(resolve(process.cwd(), "src/test/fixtures/nordea-transactions.csv"), "utf8");
    expect(detectHoldingsImportIssue(fixture)).toBe("This looks like a broker transaction export, not a holdings file.");
  });

  it("flags missing ticker column", () => {
    const csv = "name,quantity\nGold,10";
    expect(detectHoldingsImportIssue(csv)).toBe("Could not detect ticker column");
  });
});
