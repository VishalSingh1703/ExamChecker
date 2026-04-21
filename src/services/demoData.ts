import type { HistoryRecord, Question, QuestionResult } from '../types';
import { getGrade } from '../utils/scoring';
import { saveReport } from './reports';
import { supabase } from '../lib/supabase';

// ── Demo dataset ──────────────────────────────────────────────────────────────

const DEMO_STUDENT_NAME = 'DemoStudent';
const DEMO_STUDENT_ID = 'DEMO-001';
const DEMO_CLASS = 'Class 11';
const DEMO_SECTION = 'D';

const SUBJECTS = ['Mathematics', 'Biology', 'Chemistry', 'Physics', 'English'];

interface ExamSpec { term: string; total: number; date: string }

const EXAMS: ExamSpec[] = [
  { term: 'UT1', total: 20, date: '2025-01-15T09:00:00.000Z' },
  { term: 'UT2', total: 20, date: '2025-02-20T09:00:00.000Z' },
  { term: 'FT1', total: 80, date: '2025-03-25T09:00:00.000Z' },
  { term: 'UT3', total: 20, date: '2025-07-10T09:00:00.000Z' },
  { term: 'UT4', total: 20, date: '2025-08-15T09:00:00.000Z' },
  { term: 'FT2', total: 80, date: '2025-10-20T09:00:00.000Z' },
];

// [subjectIndex][examIndex] = marks scored
const SCORES = [
  //            UT1  UT2  FT1  UT3  UT4  FT2
  /* Maths   */ [14,  16,  54,  15,  17,  62],
  /* Biology */ [11,  14,  50,  13,  16,  56],
  /* Chem    */ [ 9,  11,  44,  13,  15,  58],
  /* Physics */ [16,  15,  63,  17,  19,  72],
  /* English */ [18,  17,  68,  19,  18,  74],
];

export function generateDemoRecords(): HistoryRecord[] {
  const records: HistoryRecord[] = [];

  for (let si = 0; si < SUBJECTS.length; si++) {
    const subject = SUBJECTS[si];
    for (let ei = 0; ei < EXAMS.length; ei++) {
      const exam = EXAMS[ei];
      const scored = SCORES[si][ei];
      const total = exam.total;
      const percentage = Math.round((scored / total) * 100);

      const question: Question = {
        id: 1,
        question: `${subject} — ${exam.term}`,
        expectedAnswer: 'Demo record',
        marks: total,
      };

      const simScore = scored / total;
      const result: QuestionResult = {
        questionId: 1,
        extractedText: '',
        similarityScore: simScore,
        similarityMethod: 'keyword',
        marksAwarded: scored,
        maxMarks: total,
        status: simScore >= 1 ? 'full' : simScore > 0.4 ? 'partial' : 'zero',
      };

      records.push({
        id: `demo-${subject.toLowerCase().replace(/\s/g, '-')}-${exam.term.toLowerCase()}`,
        savedAt: exam.date,
        examTitle: `${exam.term} — ${subject}`,
        subject,
        term: exam.term,
        examClass: DEMO_CLASS,
        studentName: DEMO_STUDENT_NAME,
        studentSection: DEMO_SECTION,
        studentId: DEMO_STUDENT_ID,
        checkingMode: 'medium',
        scored,
        total,
        percentage,
        grade: getGrade(percentage),
        questions: [question],
        results: [result],
      });
    }
  }

  return records;
}

/**
 * Seeds demo records into localStorage and Supabase for the current user.
 * Safe to call multiple times — records with existing IDs are skipped.
 */
export async function seedDemoData(userId: string): Promise<number> {
  const histKey = userId ? `exam-history-${userId}` : 'exam-history';
  let existing: HistoryRecord[] = [];
  try { existing = JSON.parse(localStorage.getItem(histKey) ?? '[]'); } catch { existing = []; }
  const existingIds = new Set(existing.map(r => r.id));

  const records = generateDemoRecords();
  const fresh = records.filter(r => !existingIds.has(r.id));
  if (fresh.length === 0) return 0;

  // Save to localStorage
  try {
    localStorage.setItem(histKey, JSON.stringify([...fresh, ...existing]));
  } catch (storageErr) {
    console.error('[demoData] localStorage quota exceeded:', storageErr);
  }

  // Save to Supabase (fire-and-forget, best-effort)
  if (supabase && userId) {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (uid) {
      for (const r of fresh) {
        await saveReport(r, r.id, uid);
      }
    }
  }

  return fresh.length;
}
