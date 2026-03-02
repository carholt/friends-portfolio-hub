const requiredEnvVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

function getEnvVar(name: (typeof requiredEnvVars)[number]): string {
  const value = import.meta.env[name];
  if (!value || String(value).trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: getEnvVar("VITE_SUPABASE_URL"),
  supabaseAnonKey: getEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY"),
};
