import { describe, expect, it } from "vitest";
import { buildPreviewRows, detectBrokerByHeaders, parseCsvRows, parseFlexibleDate } from "@/lib/transaction-import";

describe("Nordea transaction import parsing", () => {
  it("detects nordea csv and parses semicolon + swedish decimals", () => {
    const csv = "\uFEFFAffärsnr;Transaktionstyp;Avslutsdatum;Likviddag;Antal/Nominellt;Kurs;Courtage;Belopp i SEK;Symbol\n123;Köp;Wed Mar 04 00:00:00 CET 2026;2026-03-06;10;1,07;2,50;-13,20;NDA";
    const rows = parseCsvRows(csv);
    expect(detectBrokerByHeaders(rows)).toBe("nordea");
    const preview = buildPreviewRows(rows, "nordea");
    expect(preview[0].tx.price).toBeCloseTo(1.07, 2);
    expect(preview[0].tx.fees).toBeCloseTo(2.5, 2);
    expect(preview[0].tx.total_local).toBeCloseTo(-13.2, 2);
    expect(preview[0].tx.trade_date).toBe("2026-03-03");
  });

  it("parses CET date strings robustly", () => {
    expect(parseFlexibleDate("Wed Mar 04 00:00:00 CET 2026")).toMatch(/^2026-03-0[34]$/);
  });
});
