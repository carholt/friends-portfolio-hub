# Friends Portfolio Hub

Portfolio sharing app built with React, Vite, Supabase, and a scheduled Supabase Edge Function for daily market prices.

## Repository status and guardrails

- No runtime secrets are committed to the repo.
- Local environment files are ignored by Git and must not be committed.
- Use `.env.example` as the only committed env template.

## 1) Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Provide frontend env vars in your shell (or local tooling), then run dev server:

   ```bash
   export VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
   export VITE_SUPABASE_PUBLISHABLE_KEY="<supabase-anon-key>"
   npm run dev
   ```

Required frontend env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

If either variable is missing, the app renders a friendly setup error screen with fix instructions instead of a blank page.

## 2) AWS Amplify deployment (Vite SPA)

This repo includes `amplify.yml` configured for Vite:

- `npm ci`
- `npm run build`
- publish `dist`

Deployment steps:

1. In AWS Amplify, connect this GitHub repository and select the `main` branch.
2. Confirm Amplify uses repository `amplify.yml`.
3. In Amplify **Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. In Amplify **Rewrites and redirects**, add SPA fallback:
   - Source: `/*`
   - Target: `/index.html`
   - Type: `200 (Rewrite)`
5. Deploy.

## 3) Supabase migrations, function deploy, and secrets

1. Login and link project:

   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   ```

2. Apply migrations:

   ```bash
   supabase db push
   ```

3. Deploy Edge Function (`update-prices`):

   ```bash
   supabase functions deploy update-prices --no-verify-jwt
   ```

4. Set required Supabase secrets:

   ```bash
   supabase secrets set TWELVE_DATA_API_KEY=<twelve-data-api-key>
   supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

## 4) GitHub Actions secrets and daily cron

### CI workflow

File: `.github/workflows/ci.yml`

- Triggers: push to `main`, pull requests.
- Runtime: Node.js 20.
- Commands: `npm ci`, `npm test`, `npm run build`.
- CI injects placeholder values for:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

### Daily price update cron

File: `.github/workflows/daily-price-update.yml`

- Triggers:
  - `schedule` (daily)
  - `workflow_dispatch`
- Calls Supabase Edge Function endpoint: `POST https://<project-ref>.functions.supabase.co/update-prices`

Required GitHub repository secrets:

- `SUPABASE_FUNCTION_URL` (example: `https://<project-ref>.functions.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`

## 5) Supabase Auth URL configuration for Amplify

In Supabase Dashboard → **Authentication** → **URL Configuration**:

1. Set **Site URL** to your Amplify production URL (or custom domain).
2. Add **Redirect URLs** for all active environments, e.g.:
   - `https://main.<app-id>.amplifyapp.com`
   - `https://www.yourdomain.com`
   - `http://localhost:5173`

## 6) User onboarding behavior

- New users with **no portfolios** and `profiles.onboarding_completed = false` are shown a 3-step onboarding flow on Home:
  1. Create first portfolio (name + base currency)
  2. Add first holding (symbol + quantity + optional average cost)
  3. Choose visibility
- If a user already has a portfolio, onboarding is skipped.
- Completing the flow sets `profiles.onboarding_completed = true`.

## 7) Missing-price behavior

- Portfolio total value prefers latest server valuation from `portfolio_valuations`.
- If no valuation exists yet, UI shows an estimated client-side total marked **Estimated**.
- Holdings without a latest price are marked **Unpriced** and contribute zero to the estimate.

## 8) Troubleshooting

### Login redirect problems

- Verify Supabase **Site URL** matches your canonical deployed frontend URL.
- Verify every callback/origin URL is present in Supabase **Redirect URLs**.
- If using a custom domain on Amplify, include both Amplify domain and custom domain while migrating.

### Cron runs but no prices written

- Confirm GitHub secrets `SUPABASE_FUNCTION_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Confirm Supabase function secrets `TWELVE_DATA_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Check workflow run logs for curl response text.
- Check Supabase Edge Function logs for upstream API errors.

### Leaderboard empty

- Ensure portfolios and holdings exist.
- Ensure price updates have run and generated valuation rows.
- Ensure portfolio visibility and membership rules allow the signed-in user to access the portfolios.

## 9) Manual steps outside git

- [ ] Set Amplify env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
- [ ] Configure Amplify SPA rewrite (`/*` → `/index.html`, 200 rewrite).
- [ ] Configure Supabase Auth URL settings (Site URL + Redirect URLs).
- [ ] Set Supabase Edge Function secrets (`TWELVE_DATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] Set GitHub Actions secrets (`SUPABASE_FUNCTION_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
