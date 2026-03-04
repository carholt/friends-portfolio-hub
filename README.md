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
- Client must only use `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep `SUPABASE_SERVICE_ROLE_KEY` in Edge Functions/GitHub secrets only.
- If group pages show empty boards, confirm user has a `group_members` row and check RLS policies in migrations.
