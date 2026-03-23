import { supabase } from '../lib/supabase';
import type { HistoryRecord } from '../types';

/**
 * Insert a new report. Uses ON CONFLICT DO NOTHING so calling this twice
 * with the same (user_id, session_id) is always safe — the second call is
 * silently dropped by the DB unique constraint.
 * Returns true if inserted, false if skipped or Supabase unavailable.
 */
export async function saveReport(
  record: HistoryRecord,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('reports')
    .upsert(
      { id: record.id, user_id: userId, session_id: sessionId, data: record },
      { onConflict: 'user_id,session_id', ignoreDuplicates: true },
    );

  if (error) {
    console.error('[reports] saveReport:', error.message);
    return false;
  }
  return true;
}

/**
 * Fetch all reports for a user, newest first.
 * Returns an empty array if Supabase is unavailable or user has no records.
 */
export async function loadReports(userId: string): Promise<HistoryRecord[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('reports')
    .select('data')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[reports] loadReports:', error.message);
    return [];
  }

  return (data ?? []).map((row) => row.data as HistoryRecord);
}

/**
 * Overwrite the data JSONB for an existing report (e.g. after Update modal saves).
 * RLS also enforces user_id match on the server side.
 */
export async function updateReport(
  record: HistoryRecord,
  userId: string,
): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('reports')
    .update({ data: record })
    .eq('id', record.id)
    .eq('user_id', userId);

  if (error) {
    console.error('[reports] updateReport:', error.message);
    return false;
  }
  return true;
}
