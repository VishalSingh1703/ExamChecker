/**
 * Single source of truth for all build-time environment variables.
 * Nothing else in the app should touch import.meta.env directly.
 */

function read(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  return value?.trim() ?? '';
}

export const env = {
  supabaseUrl: read('VITE_SUPABASE_URL'),
  supabaseAnonKey: read('VITE_SUPABASE_ANON_KEY'),
  geminiApiKey: read('VITE_GEMINI_API_KEY'),
  hfApiKey: read('VITE_HF_API_KEY'),
  adminEmail: read('VITE_ADMIN_EMAIL'),
} as const;

/** Prefer the user-entered session key; fall back to the build-time key. */
export function resolveGeminiKey(contextKey?: string): string {
  return contextKey?.trim() || env.geminiApiKey;
}
