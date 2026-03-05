# Friends Portfolio Hub

Portfolio sharing app built with React + Vite, with Supabase Postgres/Auth/Edge Functions.

## Deploy target (primary)

This repo is configured for **Cloudflare Pages + Supabase**.

- Package manager: **npm**
- Build command: `npm ci && npm run build`
- Build output directory: `dist`

## 1) Secrets hygiene policy

- Runtime secrets must never be committed.
- `.env` and environment variants are gitignored.
- `.env.example` is the only committed env template.
- CI fails if:
  - merge conflict markers are present,
  - a tracked file named `.env` exists,
  - obvious leaked secret patterns are detected (`sb_secret_...`, hard-coded service role key assignments).

## 2) Local development

```bash
npm install
cp .env.example .env.local
```

Set required frontend environment variables (example):

```bash
export VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
export VITE_SUPABASE_PUBLISHABLE_KEY="<supabase-anon-key>"
npm run dev
```

Required frontend variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## 3) Cloudflare Pages deployment

Create a Pages project connected to this repository and configure:

- **Framework preset**: Vite
- **Build command**: `npm ci && npm run build`
- **Build output directory**: `dist`

### Environment variables in Cloudflare Pages

In **Cloudflare Dashboard → Pages → <project> → Settings → Variables and Secrets**, add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Set values for both **Production** and **Preview** environments.

### SPA routing

This repo includes `public/_redirects` with:

```txt
/* /index.html 200
```

That file is emitted into `dist/_redirects` during Vite build so deep links route to the SPA entrypoint on Pages.

## 4) Supabase migrations (ordered + runnable)

Migrations are stored in `supabase/migrations` and ordered by timestamp prefix.

List migration order:

```bash
ls -1 supabase/migrations/*.sql | sort
```

Apply to linked project:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

## 5) Supabase Edge Function deployment (`update-prices`)

Deploy function:

```bash
supabase functions deploy update-prices --no-verify-jwt
```

Set function/runtime secrets:

```bash
supabase secrets set TWELVE_DATA_API_KEY=<twelve-data-api-key>
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

## 6) Supabase Auth URL configuration (Cloudflare + localhost)

In Supabase Dashboard → **Authentication → URL Configuration**:

1. Set **Site URL** to your Cloudflare Pages production domain, for example:
   - `https://friends-portfolio-hub.pages.dev`
   - or your custom domain (recommended)
2. Add **Redirect URLs** for all active environments, for example:
   - `https://friends-portfolio-hub.pages.dev`
   - `https://<preview-subdomain>.pages.dev`
   - `http://localhost:5173`

## 7) GitHub Actions

### CI

Workflow: `.github/workflows/ci.yml`

Runs:

1. repository safety guards,
2. `npm ci`,
3. tests,
4. build.

### Scheduled price updater

Workflow: `.github/workflows/daily-price-update.yml`

- Trigger: daily cron + manual dispatch
- Action: `POST` to Supabase function endpoint

Required GitHub repository secrets:

- `SUPABASE_FUNCTION_URL` (example: `https://<project-ref>.functions.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`

## 8) Copy/paste deployment checklist

```bash
# 1) Install + verify app builds exactly like Cloudflare
npm ci && npm run build

# 2) Login + link Supabase project
supabase login
supabase link --project-ref <project-ref>

# 3) Apply migrations
supabase db push

# 4) Deploy Edge Function
supabase functions deploy update-prices --no-verify-jwt

# 5) Set Edge Function secrets
supabase secrets set TWELVE_DATA_API_KEY=<twelve-data-api-key>
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Manual dashboard steps remaining:

- Cloudflare Pages: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Settings → Variables and Secrets.
- Supabase Auth: set Site URL + Redirect URLs for Cloudflare production/preview and localhost.
- GitHub repo secrets: set `SUPABASE_FUNCTION_URL` and `SUPABASE_SERVICE_ROLE_KEY` for scheduled workflow.

## 9) Portfolio Tracker 2026 notes & pitfalls

- Holdings are now derived from the `transactions` ledger (`buy`, `sell`, `adjust`, `remove`) via DB triggers. Do not write holdings directly from client code.
- New social table `group_messages` is RLS-protected: only group members can read/write, author/group owner can delete.
- Use `resolve-asset-ticker` Edge Function for ISIN mapping. Keep `metadata_json.isin` and set `assets.symbol` to pricing ticker.
- Exchange-aware pricing is supported through `metadata_json.provider_symbol` and `metadata_json.exchange_code` (for example `PAAS:TSX`, `USA:TSXV`). Keep `assets.symbol` as the canonical ticker key and let the resolver manage provider qualification.
- Client must only use `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep `SUPABASE_SERVICE_ROLE_KEY` in Edge Functions/GitHub secrets only.
- If group pages show empty boards, confirm user has a `group_members` row and check RLS policies in migrations.

## 10) Ticker/exchange resolution playbook

1. Open a portfolio with `Unpriced` holdings.
2. Click **Resolve ticker** and use **Suggest**.
3. Confirm/edit ticker and optionally set exchange code (`TSX`, `TSXV`, etc.).
4. Save to apply the server-side merge/migration.

The resolver preserves `metadata_json.isin`, writes `metadata_json.provider_symbol`, and safely merges overlapping holdings by portfolio.

## 10b) Canonical symbol resolution + unpriced behavior

- `assets.price_symbol` is now the canonical TwelveData lookup symbol (for example `SSV:TSXV`).
- `assets.exchange_code` stores the listing exchange (`TSX`, `TSXV`, `NYSE`, `NASDAQ`, etc.).
- `assets.symbol_resolution_status` tracks: `unknown`, `resolved`, `ambiguous`, or `invalid`.
- Import preview resolves each unique symbol and marks rows as resolved/ambiguous/invalid before import.
- UI shows **Fix symbol** for unpriced or invalid holdings so users can choose the correct listing.
- **Unpriced** means the app could not fetch a positive quote (typically unresolved/invalid symbol, ambiguous listing, or no provider quote).

### Troubleshooting: prices are empty

If prices are missing after running the updater:

1. Check holdings marked **Unpriced** and use **Fix symbol**.
2. Confirm assets have `price_symbol` + `symbol_resolution_status='resolved'`.
3. Re-run `update-prices` after symbol resolution.
4. Ensure `TWELVE_DATA_API_KEY` is configured in Supabase function secrets.

## 11) Pricing diagnostics (admin-only dry run)

Deploy function:

```bash
supabase functions deploy price-resolution-diagnostics --no-verify-jwt
```

Configure secret token:

```bash
supabase secrets set PRICE_DIAGNOSTIC_TOKEN=<long-random-token>
```

Dry-run example:

```bash
curl -X POST "https://<project-ref>.functions.supabase.co/price-resolution-diagnostics" \
  -H "content-type: application/json" \
  -H "x-diagnostic-token: $PRICE_DIAGNOSTIC_TOKEN" \
  -d '{"symbols":["B",{"symbol":"PAAS","exchange":"TSX"},{"symbol":"USA","exchange":"TSXV"}]}'
```

Response includes which symbols resolve, returned prices, and provider error messages for failed symbols.

## 12) TwelveData symbol validation + price smoke test

Run with a newline-separated ticker file (defaults to `tickers.txt` in repo root):

```bash
export TWELVEDATA_API_KEY="<your-api-key>"
npm run validate:twelvedata
# or provide a custom file path
npm run validate:twelvedata -- ./path/to/tickers.txt
```

What it does:

- Resolves each ticker using TwelveData `/stocks?symbol=...`.
- Recommends a pricing symbol (`SYMBOL` or `SYMBOL:EXCHANGE` when an exchange is required).
- Calls `/price` in throttled batches (8 symbols/minute, free-tier safe) with retry/backoff on rate limits.

Report statuses:

- `ok`: price returned.
- `plan_gated`: symbol/exchange requires a higher TwelveData plan.
- `invalid_symbol`: symbol could not be resolved/priced.
- `rate_limited`: free-tier credit/rate window exceeded (tool retries before final status).

Security note: the script reads only `TWELVEDATA_API_KEY` from environment variables and does not print the key.

## 13) Company AI reports pipeline

### Deploy the new Edge Function

```bash
supabase functions deploy company-ai-report
```

### Required Supabase secrets

```bash
supabase secrets set OPENAI_API_KEY=<openai-api-key>
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Operational notes

- Reports are created via `public.request_company_ai_report(...)` and processed by `company-ai-report` function.
- Daily rate limit is capped at **5 reports per user per rolling day**.
- Cache guard blocks regeneration if an asset already has a completed report in the last 24h unless `force=true` is passed in assumptions.
- OpenAI web search is used in **Standard** mode; **Quick** mode skips web search and uses stored context.

### Troubleshooting

- **Stuck queued**: check network tab for `functions.invoke('company-ai-report')` failure and verify JWT/auth session.
- **Stuck running**: inspect function logs for OpenAI timeout or schema parsing errors; failed runs are marked `failed` with `error`.
- **No sources returned**: retry in Standard mode (web search enabled), or ensure company + metrics data exists.
- **Rate limit errors**: wait for the rolling window or use a different authenticated user.
