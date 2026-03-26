import { supabase } from '../lib/supabase';

export interface UserStats {
  user_id: string;
  reports_generated: number;
  pages_scanned: number;
  words_extracted: number;
}

/**
 * Atomically increment usage stats for a user via the `increment_stats` RPC.
 * Called once per report save (fire-and-forget).
 */
export async function incrementUserStats(
  userId: string,
  pages: number,
  words: number,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('increment_stats', {
    p_user_id: userId,
    p_reports: 1,
    p_pages: pages,
    p_words: words,
  });
  if (error) console.error('[stats] incrementUserStats:', error.message);
}

/**
 * Load stats for all users (admin view).
 * Returns a Map keyed by user_id for O(1) lookup.
 */
export async function loadAllStats(): Promise<Map<string, UserStats>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase
    .from('user_stats')
    .select('user_id, reports_generated, pages_scanned, words_extracted');
  if (error) {
    console.error('[stats] loadAllStats:', error.message);
    return new Map();
  }
  return new Map((data ?? []).map(r => [r.user_id, r as UserStats]));
}
