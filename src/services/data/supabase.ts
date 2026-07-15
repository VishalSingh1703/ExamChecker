import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

export let supabase: SupabaseClient | null = null;
export let supabaseError: string | null = null;

if (!env.supabaseUrl || env.supabaseUrl === 'your_supabase_project_url' ||
    !env.supabaseAnonKey || env.supabaseAnonKey === 'your_supabase_anon_key') {
  supabaseError = 'Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env';
} else {
  try {
    supabase = createClient(env.supabaseUrl, env.supabaseAnonKey);
  } catch (e) {
    supabaseError = e instanceof Error ? e.message : 'Failed to initialize Supabase';
  }
}

/** Returns the signed-in user's id, or null (also when auth is unreachable). */
export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
