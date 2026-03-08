import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("import preview low-confidence mapping UX", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/TransactionImportDialog.tsx"), "utf8");

  it("shows warning badge and fix mapping action", () => {
    expect(source).toContain("Low-confidence symbol mapping detected");
    expect(source).toContain("Fix mapping");
    expect(source).toContain("window.location.assign('/settings/symbol-resolution')");
  });
});
