import { supabase } from '../lib/supabase';
import type { SubPart } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BankQuestion {
  id: string;
  question: string;
  expectedAnswer: string;
  marks: number;
  keywords?: string[];
  subparts?: SubPart[];
  diagram?: string;
}

export interface BankChapter {
  id: string;
  userId: string;
  class: string;
  subject: string;
  chapter: string;
  questions: BankQuestion[];
  createdAt: string;
}

// ── LocalStorage helpers ──────────────────────────────────────────────────────

function bankKey(userId: string) {
  return userId ? `question-bank-${userId}` : 'question-bank';
}

function loadLocal(userId: string): BankChapter[] {
  try { return JSON.parse(localStorage.getItem(bankKey(userId)) ?? '[]'); }
  catch { return []; }
}

function saveLocal(userId: string, chapters: BankChapter[]) {
  try {
    localStorage.setItem(bankKey(userId), JSON.stringify(chapters));
  } catch (err) {
    console.error('[questionBank] localStorage quota exceeded:', err);
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveChapter(chapter: BankChapter, userId: string): Promise<void> {
  const existing = loadLocal(userId);
  const idx = existing.findIndex(c => c.id === chapter.id);
  if (idx >= 0) existing[idx] = chapter;
  else existing.unshift(chapter);
  saveLocal(userId, existing);

  if (!supabase || !userId) return;
  await supabase.from('question_bank').upsert({
    id: chapter.id,
    user_id: userId,
    class: chapter.class,
    subject: chapter.subject,
    chapter: chapter.chapter,
    questions: chapter.questions,
    created_at: chapter.createdAt,
  });
}

export async function loadChapters(
  userId: string,
  cls?: string,
  subject?: string,
): Promise<BankChapter[]> {
  let local = loadLocal(userId);
  if (cls) local = local.filter(c => c.class === cls);
  if (subject) local = local.filter(c => c.subject.toLowerCase() === subject.toLowerCase());

  if (!supabase || !userId) return local;

  let query = supabase.from('question_bank').select('*').eq('user_id', userId);
  if (cls) query = query.eq('class', cls);
  if (subject) query = query.eq('subject', subject);
  const { data } = await query;
  if (!data) return local;

  const remote: BankChapter[] = data.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    userId: r.user_id as string,
    class: r.class as string,
    subject: r.subject as string,
    chapter: r.chapter as string,
    questions: r.questions as BankQuestion[],
    createdAt: r.created_at as string,
  }));

  const merged = new Map(local.map(c => [c.id, c]));
  for (const r of remote) merged.set(r.id, r);
  const result = [...merged.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  saveLocal(userId, result);
  return result;
}

export async function deleteChapter(id: string, userId: string): Promise<void> {
  saveLocal(userId, loadLocal(userId).filter(c => c.id !== id));
  if (supabase && userId) {
    await supabase.from('question_bank').delete().eq('id', id).eq('user_id', userId);
  }
}
