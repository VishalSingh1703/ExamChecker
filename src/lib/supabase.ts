import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export let supabase: SupabaseClient | null = null;
export let supabaseError: string | null = null;

if (!supabaseUrl || supabaseUrl === 'your_supabase_project_url' ||
    !supabaseAnonKey || supabaseAnonKey === 'your_supabase_anon_key') {
  supabaseError = 'Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env';
} else {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  } catch (e) {
    supabaseError = e instanceof Error ? e.message : 'Failed to initialize Supabase';
  }
}
