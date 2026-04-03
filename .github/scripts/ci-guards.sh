#!/usr/bin/env bash
set -euo pipefail

echo "Running repository safety guards..."

if git grep -n -E '^(<<<<<<< |=======|>>>>>>> )' -- .; then
  echo "Merge conflict markers detected. Resolve before commit."
  exit 1
fi

tracked_env_files=$(git ls-files | grep -E '(^|/)\.env$' || true)
if [ -n "${tracked_env_files}" ]; then
  echo "Tracked .env file detected. Remove it from git history/state:"
  echo "${tracked_env_files}"
  exit 1
fi

if git grep -n -E 'sb_secret_[A-Za-z0-9_]+' -- . ':(exclude)package-lock.json'; then
  echo "Potential leaked Supabase secret token (sb_secret_*) found in repository files."
  exit 1
fi

if git grep -n -I -E '(service_role(_key)?\s*[:=]\s*["'"'"'][^"'"'"'<$[:space:]][^"'"'"']+)|(SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'"'"'][^"'"'"'<$[:space:]][^"'"'"']+)' -- . ':(exclude)README.md'; then
  echo "Potential hard-coded service role key found in repository files."
  exit 1
fi

node scripts/check-company-report-schema-refs.mjs

echo "Repository safety guards passed."
