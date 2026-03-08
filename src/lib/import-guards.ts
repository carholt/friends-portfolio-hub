import { detectMapping, parseDelimitedFile } from "@/lib/import-engine";

export function detectHoldingsImportIssue(content: string): string | null {
  const parsed = parseDelimitedFile(content);
  const mapping = detectMapping(parsed.headers, parsed.sampleRows);
  if (mapping.kind === "transactions") return "This looks like a broker transaction export, not a holdings file.";
  if (!mapping.columns.symbol) return "Could not detect ticker column";
  return null;
}
