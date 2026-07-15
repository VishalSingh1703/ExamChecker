/**
 * Account-level persistence for Setup subjects (question paper + answer key
 * per class). Local-first: localStorage renders instantly, Supabase syncs the
 * same data across devices — mirrors the questionBank.ts pattern.
 *
 * Requires a `subjects` table in Supabase (see SQL in the project docs):
 *   id uuid PK, user_id uuid, name text, class text, questions jsonb,
 *   updated_at timestamptz — with RLS restricting rows to auth.uid().
 */
import { supabase } from './supabase';
import type { SavedSubject, SavedSubjectQuestion } from '../../types';
import { readJson, writeJson, storageKeys } from '../storage';

// ── LocalStorage ──────────────────────────────────────────────────────────────

export function loadLocalSubjects(userId: string): SavedSubject[] {
  return readJson<SavedSubject[]>(storageKeys.subjects(userId), []);
}

function saveLocal(userId: string, subjects: SavedSubject[]) {
  writeJson(storageKeys.subjects(userId), subjects);
}

// ── Cloud sync ────────────────────────────────────────────────────────────────

/**
 * Merge localStorage with the account's cloud subjects (remote wins on id
 * collision), persist the merged list locally, and return it.
 */
export async function syncSubjects(userId: string): Promise<SavedSubject[]> {
  const local = loadLocalSubjects(userId);
  if (!supabase || !userId) return local;

  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .eq('user_id', userId);

  if (error || !data) {
    if (error) console.error('[subjects] sync:', error.message);
    return local;
  }

  const remote: SavedSubject[] = data.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    examClass: r.class as string,
    questions: r.questions as SavedSubjectQuestion[],
  }));

  const merged = new Map(local.map(s => [s.id, s]));
  for (const r of remote) merged.set(r.id, r);
  const result = [...merged.values()];
  saveLocal(userId, result);
  return result;
}

/** Save one subject: update the local list and upsert to the cloud. */
export async function upsertSubject(subject: SavedSubject, userId: string): Promise<void> {
  const existing = loadLocalSubjects(userId);
  const idx = existing.findIndex(s => s.id === subject.id);
  if (idx >= 0) existing[idx] = subject;
  else existing.push(subject);
  saveLocal(userId, existing);

  if (!supabase || !userId) return;
  const { error } = await supabase.from('subjects').upsert({
    id: subject.id,
    user_id: userId,
    name: subject.name,
    class: subject.examClass,
    questions: subject.questions,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('[subjects] upsert:', error.message);
}

/** Delete one subject locally and from the cloud. */
export async function deleteSubject(id: string, userId: string): Promise<void> {
  saveLocal(userId, loadLocalSubjects(userId).filter(s => s.id !== id));

  if (!supabase || !userId) return;
  const { error } = await supabase.from('subjects').delete().eq('id', id).eq('user_id', userId);
  if (error) console.error('[subjects] delete:', error.message);
}
