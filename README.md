# Friends Portfolio Hub

Simple portfolio sharing app built with **React + Vite + Supabase**.

## What this repo includes

- Strong env hygiene (`.env` ignored, `.env.example` tracked)
- Auth guards + loading-safe routing
- RLS-backed access (`can_access_portfolio`) and server-side leaderboard RPC (`get_leaderboard`)
- Import/export (CSV + JSON) with row validation
- Daily price update edge function + GitHub Actions scheduler

---

## 1) Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required frontend env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The app fails fast on startup if either is missing.

---

## 2) Deploy frontend to AWS Amplify (Vite SPA)

1. In Amplify, connect this GitHub repo/branch.
2. Build settings:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
3. Add environment variables in Amplify:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Add SPA rewrite rule:
   - Source: `</^[^.]+$|\.(?!(css|js|png|jpg|jpeg|gif|svg|ico|json|txt|woff|woff2|ttf)$)([^.]+$)/>`
   - Target: `/index.html`
   - Type: `200 (Rewrite)`
5. Deploy.

---

## 3) Supabase setup (DB + RLS + function)

### Run migrations

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This creates required tables and policies for:

- profiles, groups, group_members, group_invites
- portfolios, holdings, assets, prices, portfolio_valuations
- RLS visibility model (`private`, `authenticated`, `group`, `public`)
- helper functions:
  - `can_access_portfolio(portfolio_id)`
  - `get_leaderboard(period)`

### Deploy edge function

```bash
supabase functions deploy update-prices --no-verify-jwt
```

### Required function secrets

```bash
supabase secrets set TWELVE_DATA_API_KEY=your_twelve_data_key
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

---

## 4) GitHub Actions daily price update

Workflow file: `.github/workflows/daily-price-update.yml`

### Required GitHub secrets

- `SUPABASE_FUNCTION_URL` (e.g. `https://<project-ref>.functions.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`

### Trigger manually

- GitHub → Actions → **Daily price update** → **Run workflow**

---

## 5) CI build

Workflow file: `.github/workflows/ci.yml`

Runs `npm ci` + `npm run build` on push/PR with placeholder Vite env vars.

---

## 6) Troubleshooting

### Auth redirect URL issues

- In Supabase Auth settings, ensure your Amplify domain is in:
  - **Site URL**
  - **Redirect URLs**
- Include local URL during dev (`http://localhost:5173`).

### Prices not updating

- Confirm `TWELVE_DATA_API_KEY` is set in Supabase secrets.
- Manually run the GitHub workflow and inspect response logs.
- Confirm holdings exist (function only fetches prices for assets in holdings).

### Leaderboard empty

- Ensure at least one valuation exists in `portfolio_valuations`.
- Confirm portfolio visibility and membership rules allow access.
- Run `update-prices` once to generate latest valuations.

---

## 7) Manual dashboard steps (cannot be fully automated in code)

1. Add Amplify env vars + rewrite rule.
2. Configure Supabase Auth redirect URLs.
3. Set Supabase function secrets.
4. Add GitHub Actions secrets.

## 8) User onboarding behavior

- New users with no portfolios and `profiles.onboarding_completed = false` are shown a 3-step onboarding flow on Home:
  1. Create first portfolio (name + base currency)
  2. Add first holding (symbol + quantity + optional average cost)
  3. Choose visibility
- If a user already has a portfolio, onboarding is skipped.
- Completing the flow sets `profiles.onboarding_completed = true`.

## 9) What happens when prices are missing

- Portfolio total value prefers latest server valuation from `portfolio_valuations`.
- If no valuation exists yet, UI shows an estimated client-side total and marks it as **Estimated**.
- Holdings without a latest price are marked as **Unpriced** and contribute zero to the estimated total.
