import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { env } from "@/config/env";
import type { AppBootstrapData } from "@/hooks/useAppBootstrap";

interface Props {
  bootstrap?: AppBootstrapData;
  importMode?: "holdings" | "transactions" | "none";
}

export function DebugPanel({ bootstrap, importMode = "none" }: Props) {
  const location = useLocation();
  const enabled = import.meta.env.DEV || String(import.meta.env.VITE_DEBUG_UI || "false").toLowerCase() === "true";
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const importHint = params.get("tximport") === "1" ? "transactions" : params.get("import") === "1" ? "holdings" : "none";

  if (!enabled) return null;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
      <p className="font-medium">Debug diagnostics</p>
      <p>auth user loaded: {String(bootstrap?.userLoaded ?? false)}</p>
      <p>profile loaded: {String(bootstrap?.profileLoaded ?? false)}</p>
      <p>onboardingCompleted: {String(bootstrap?.onboardingCompleted ?? false)}</p>
      <p>portfolio count: {bootstrap?.portfolioCount ?? 0}</p>
      <p>paywall enabled: {String(bootstrap?.paywallEnabled ?? env.paywallEnabled)}</p>
      <p>subscription tier: {bootstrap?.subscriptionTier ?? "free"}</p>
      <p>import mode: {importMode !== "none" ? importMode : importHint}</p>
      <p>commit: {import.meta.env.VITE_COMMIT_HASH || "n/a"}</p>
    </div>
  );
}
