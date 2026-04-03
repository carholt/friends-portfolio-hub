import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const migrationsDir = resolve(repoRoot, "supabase/migrations");

const migrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n")
  .toLowerCase();

const sources = [
  resolve(repoRoot, "src/pages/AssetCompany.tsx"),
  resolve(repoRoot, "src/lib/company-ai-report-client.ts"),
  resolve(repoRoot, "supabase/functions/company-ai-report/index.ts"),
  resolve(repoRoot, "supabase/functions/purchase-report/index.ts"),
  resolve(repoRoot, "supabase/functions/stripe-webhook/index.ts"),
];

const relationRefs = new Set();
const rpcRefs = new Set();
for (const sourcePath of sources) {
  const text = readFileSync(sourcePath, "utf8");
  for (const match of text.matchAll(/\.from\(\s*["']([a-zA-Z0-9_]+)["']/g)) {
    if (match[1].startsWith("company_ai_report")) relationRefs.add(match[1].toLowerCase());
  }
  for (const match of text.matchAll(/\.rpc\(\s*["']([a-zA-Z0-9_]+)["']/g)) {
    if (["request_company_ai_report", "user_has_access_to_report"].includes(match[1])) {
      rpcRefs.add(match[1].toLowerCase());
    }
  }
}

const missing = [];
for (const relation of relationRefs) {
  if (!migrationSql.includes(`create table if not exists public.${relation}`) && !migrationSql.includes(`create table public.${relation}`)) {
    missing.push(`relation:${relation}`);
  }
}

for (const rpc of rpcRefs) {
  if (!migrationSql.includes(`function public.${rpc}`)) {
    missing.push(`rpc:${rpc}`);
  }
}

if (missing.length > 0) {
  console.error("Missing company report schema objects in migrations:");
  for (const item of missing) console.error(` - ${item}`);
  process.exit(1);
}

console.log("Company report schema references are covered by migrations.");
