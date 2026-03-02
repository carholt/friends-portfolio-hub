const requiredEnvVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

type EnvVarName = (typeof requiredEnvVars)[number];

const missingEnvVars = requiredEnvVars.filter((name) => {
  const value = import.meta.env[name];
  return !value || String(value).trim().length === 0;
});

function getEnvVar(name: EnvVarName): string {
  const value = import.meta.env[name];
  return value && String(value).trim().length > 0 ? value : "";
}

export const env = {
  supabaseUrl: getEnvVar("VITE_SUPABASE_URL"),
  supabaseAnonKey: getEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY"),
};

export const envError = missingEnvVars.length > 0
  ? `Missing required environment variables: ${missingEnvVars.join(", ")}`
  : null;
