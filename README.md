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

2. Provide frontend env vars in your shell (or your local tooling), then run dev server:

   ```bash
   export VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
   export VITE_SUPABASE_PUBLISHABLE_KEY="<supabase-anon-key>"
   npm run dev
   ```

Required frontend env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The app fails fast at startup if either variable is missing.

## 2) AWS Amplify deployment (Vite SPA)

This repo includes `amplify.yml` configured for Vite:

- `npm ci`
- `npm run build`
- publish `dist`

### Steps

1. In AWS Amplify, connect this repository and branch.
2. Confirm Amplify uses the repository `amplify.yml`.
3. In Amplify **Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. In Amplify **Rewrites and redirects**, add SPA fallback:
   - Source address: `/*`
   - Target address: `/index.html`
   - Type: `200 (Rewrite)`
5. Deploy.

## 3) Supabase database and migrations

1. Login and link project:

   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   ```

2. Apply migrations:

   ```bash
   supabase db push
   ```

## 4) Deploy Supabase Edge Function (`update-prices`)

Deploy using Supabase CLI:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy update-prices --no-verify-jwt
```

Set required function secrets:

```bash
supabase secrets set TWELVE_DATA_API_KEY=<twelve-data-api-key>
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

## 5) GitHub Actions automation

### CI workflow

File: `.github/workflows/ci.yml`

- Triggers: push to `main`, pull requests.
- Runtime: Node.js 20.
- Commands:
  - `npm ci`
  - `npm test`
  - `npm run build`
- CI injects placeholder values for:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

### Daily cron workflow

File: `.github/workflows/daily-price-update.yml`

- Triggers:
  - schedule (daily)
  - `workflow_dispatch`
- Calls Supabase Edge Function endpoint: `POST https://<project-ref>.functions.supabase.co/update-prices`

Set required GitHub repository secrets:

- `SUPABASE_FUNCTION_URL` (example: `https://<project-ref>.functions.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`

## 6) Supabase Auth URL configuration for Amplify

In Supabase Dashboard → **Authentication** → **URL Configuration**:

1. Set **Site URL** to your primary Amplify production URL (or custom domain).
2. Add **Redirect URLs** for all active environments, for example:
   - `https://main.<app-id>.amplifyapp.com`
   - `https://www.yourdomain.com`
   - `http://localhost:5173` (local development)

## 7) Troubleshooting

### Login redirect problems

- Verify Supabase **Site URL** matches your canonical deployed frontend URL.
- Verify every callback/origin URL is present in Supabase **Redirect URLs**.
- If using a custom domain on Amplify, include both Amplify domain and custom domain while migrating.

### Cron runs but no prices written

- Confirm GitHub secrets `SUPABASE_FUNCTION_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Confirm Supabase function secrets `TWELVE_DATA_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Check the workflow run logs for curl response text.
- Check Supabase Edge Function logs for upstream API errors.

### Leaderboard empty

- Ensure portfolios and holdings exist.
- Ensure price updates have run and generated valuation rows.
- Ensure portfolio visibility and membership rules allow the signed-in user to access the portfolios.

## 8) Manual steps that remain outside git

- Set Amplify environment variables.
- Configure Amplify rewrite/redirect SPA fallback.
- Configure Supabase Auth URL settings.
- Set Supabase function secrets.
- Set GitHub Actions secrets.
