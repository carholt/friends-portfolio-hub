import { createClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

const fallbackUrl = env.supabaseUrl || 'https://invalid.supabase.local';
const fallbackKey = env.supabaseAnonKey || 'invalid-key';

export const supabase = createClient(fallbackUrl, fallbackKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
