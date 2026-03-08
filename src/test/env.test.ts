import { describe, expect, it } from "vitest";
import { getEnvError } from "@/config/env";

describe("environment error rendering", () => {
  it("returns missing env error when keys are absent", () => {
    expect(getEnvError({})).toContain("VITE_SUPABASE_URL");
  });

  it("returns null when required env keys exist", () => {
    expect(getEnvError({ VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "abc" })).toBeNull();
  });
});
