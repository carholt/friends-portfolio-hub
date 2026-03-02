# Friends Portfolio Hub

Production-ready React + Supabase portfolio tracking application with multi-user access controls, RLS-aware data access, price updates, and historical leaderboard analytics.

## Tech stack

- React + Vite + TypeScript
- Supabase (Auth, Postgres, RLS, Edge Functions)
- Tailwind + shadcn/ui
- Vercel (frontend hosting)

## Required environment variables

### Frontend (`Vercel` / local)

Copy `.env.example` to `.env.local` for local development.

```bash
cp .env.example .env.local
```

Set:

- `VITE_SUPABASE_URL` - your Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` - Supabase anon key (public key)

> Never commit `.env` files with secrets.

### Supabase Edge Function secrets

Configure in Supabase for `update-prices` function:

- `TWELVE_DATA_API_KEY` - TwelveData API key (server-side only)
- `SUPABASE_URL` - automatically available in Supabase functions runtime
- `SUPABASE_SERVICE_ROLE_KEY` - automatically available in Supabase functions runtime

## Local development

```bash
npm install
npm run dev
```

## Database and functions deployment

1. Link/auth with Supabase CLI.
2. Run migrations:

```bash
supabase db push
```

3. Deploy edge function:

```bash
supabase functions deploy update-prices --no-verify-jwt
```

4. Set secret(s):

```bash
supabase secrets set TWELVE_DATA_API_KEY=YOUR_KEY
```

## Daily cron setup (GitHub Actions -> Edge Function)

A workflow is included at `.github/workflows/daily-price-update.yml`.

### Required GitHub repository secrets

- `SUPABASE_FUNCTION_URL` (e.g. `https://<project-ref>.functions.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`

The workflow runs daily and triggers `POST /update-prices`.

## Vercel deployment

1. Import repository in Vercel.
2. Set frontend env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Deploy.

SPA rewrites are configured in `vercel.json` to route all paths to `index.html`.

## Security and access model

Portfolio visibility is enforced in Postgres with RLS:

- `private` - owner only
- `authenticated` - any logged-in user
- `group` - group members
- `public` - everyone

The app uses server-side constrained queries and SQL functions (`can_access_portfolio`, `get_leaderboard`) to avoid frontend-only filtering.

## Import / export

- CSV import with row-level validation (symbol, asset type, quantity, avg cost, currency)
- JSON import support
- JSON export for portfolios + holdings metadata

## Auth flow

- Session persistence through Supabase auth settings
- Route guards for protected routes
- Public-only routes redirect authenticated users to dashboard
