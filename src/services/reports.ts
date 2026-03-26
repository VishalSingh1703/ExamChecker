import { supabase } from '../lib/supabase';
import type { HistoryRecord } from '../types';

export interface TrashEntry {
  record: HistoryRecord;
  deletedAt: string; // ISO string
}

const TRASH_TTL_DAYS = 7;

/**
 * Insert a new report. Uses ON CONFLICT DO NOTHING so calling this twice
 * with the same (user_id, session_id) is always safe.
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
 * Fetch all active (non-deleted) reports for a user, newest first.
 */
export async function loadReports(userId: string): Promise<HistoryRecord[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('reports')
    .select('data')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[reports] loadReports:', error.message);
    return [];
  }

  return (data ?? []).map((row) => row.data as HistoryRecord);
}

/**
 * Soft-delete: set deleted_at to now. Report moves to trash.
 */
export async function moveToTrash(id: string, userId: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('reports')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('[reports] moveToTrash:', error.message);
    return false;
  }
  return true;
}

/**
 * Restore a trashed report: clear deleted_at.
 */
export async function restoreFromTrash(id: string, userId: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('reports')
    .update({ deleted_at: null })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('[reports] restoreFromTrash:', error.message);
    return false;
  }
  return true;
}

/**
 * Load all trashed reports for a user (deleted_at IS NOT NULL).
 */
export async function loadTrash(userId: string): Promise<TrashEntry[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('reports')
    .select('data, deleted_at')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    console.error('[reports] loadTrash:', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    record: row.data as HistoryRecord,
    deletedAt: row.deleted_at as string,
  }));
}

/**
 * Hard-delete reports that have been in trash for more than TRASH_TTL_DAYS.
 */
export async function purgeExpiredTrash(userId: string): Promise<void> {
  if (!supabase) return;

  const cutoff = new Date(Date.now() - TRASH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('reports')
    .delete()
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);

  if (error) console.error('[reports] purgeExpiredTrash:', error.message);
}

/**
 * Hard-delete a single report permanently (used from trash view).
 */
export async function deleteReport(id: string, userId: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('reports')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('[reports] deleteReport:', error.message);
    return false;
  }
  return true;
}

/**
 * Overwrite the data JSONB for an existing report (e.g. after Update modal saves).
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
