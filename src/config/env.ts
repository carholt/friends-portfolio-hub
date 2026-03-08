const requiredEnvVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

type EnvVarName = (typeof requiredEnvVars)[number];

type EnvLike = Record<string, unknown>;

function getEnvVar(source: EnvLike, name: EnvVarName): string {
  const value = source[name as keyof EnvLike];
  return value && String(value).trim().length > 0 ? String(value) : "";
}

export function getEnvError(source: EnvLike): string | null {
  const missingEnvVars = requiredEnvVars.filter((name) => !getEnvVar(source, name));
  return missingEnvVars.length > 0
    ? `Missing required environment variables: ${missingEnvVars.join(", ")}`
    : null;
}

export const env = {
  supabaseUrl: getEnvVar(import.meta.env as EnvLike, "VITE_SUPABASE_URL"),
  supabaseAnonKey: getEnvVar(import.meta.env as EnvLike, "VITE_SUPABASE_PUBLISHABLE_KEY"),
  paywallEnabled: String(import.meta.env.VITE_PAYWALL_ENABLED || "false").toLowerCase() === "true",
};

export const envError = getEnvError(import.meta.env as EnvLike);
