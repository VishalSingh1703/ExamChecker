/**
 * Turning a graded practice attempt into a HistoryRecord — and storing it
 * somewhere the teacher's exam archive can never see.
 */
import type { CheckingMode, HistoryRecord, Question, QuestionResult } from '../../types';
import { calculateMarksByMode, calculateTotalScore, getGrade } from '../../utils/scoring';
import { readJson, storageKeys, writeJson } from '../../services/storage';
import { getCurrentUserId } from '../../services/data/supabase';
import { saveReport } from '../../services/data/reports';

/** Raw per-question outcome, before mode scaling. Shared by both answer paths. */
export interface RawOutcome {
  extractedText: string;
  score: number;
  /** True when the student left it blank / it wasn't found on the sheet. */
  skipped?: boolean;
}

/**
 * The single place typed and handwritten answers converge. Produces exactly the
 * payload GradingView dispatches, so a practice report renders and prints
 * identically to a graded exam.
 */
export function finalizeResults(
  questions: Question[],
  raw: Record<number, RawOutcome>,
  mode: CheckingMode,
): QuestionResult[] {
  return questions.map(q => {
    const r = raw[q.id];
    if (!r || r.skipped) {
      return {
        questionId: q.id,
        extractedText: r?.extractedText ?? '',
        similarityScore: 0,
        similarityMethod: 'semantic' as const,
        marksAwarded: 0,
        maxMarks: q.marks,
        status: 'skipped' as const,
      };
    }
    const { marks, status } = calculateMarksByMode(r.score, mode, q.marks);
    return {
      questionId: q.id,
      extractedText: r.extractedText,
      similarityScore: r.score,
      similarityMethod: 'semantic' as const,
      marksAwarded: marks,
      maxMarks: q.marks,
      status,
    };
  });
}

export function buildPracticeRecord(args: {
  attemptId: string;
  cls: string;
  subject: string;
  chapter: string;
  checkingMode: CheckingMode;
  questions: Question[];
  results: QuestionResult[];
  studentName: string;
  userId: string;
}): HistoryRecord {
  const { scored, total, percentage } = calculateTotalScore(args.results);
  return {
    id: args.attemptId,
    savedAt: new Date().toISOString(),
    examTitle: `Practice — ${args.chapter || args.subject}`,
    subject: args.subject,
    term: 'Practice',
    examClass: args.cls,
    studentName: args.studentName || 'Me',
    studentSection: 'Self Practice',
    studentId: `practice-${args.userId || 'local'}`,
    checkingMode: args.checkingMode,
    scored,
    total,
    percentage,
    grade: getGrade(percentage),
    questions: args.questions,
    results: args.results,
    kind: 'practice',
  };
}

/** Reads the practice archive — a different key from the exam archive. */
export function loadPracticeRecords(userId: string): HistoryRecord[] {
  return readJson<HistoryRecord[]>(storageKeys.practiceHistory(userId), []);
}

export function writePracticeRecords(userId: string, records: HistoryRecord[]): boolean {
  return writeJson(storageKeys.practiceHistory(userId), records);
}

/**
 * Saves an attempt locally and mirrors it to Supabase. Idempotent per attempt:
 * the local list is de-duplicated by id, and saveReport upserts on
 * (user_id, session_id) with ignoreDuplicates.
 *
 * Deliberately does NOT call incrementUserStats — that meters teacher grading
 * throughput, and practice runs would inflate it.
 */
export function savePracticeRecord(record: HistoryRecord, userId: string): boolean {
  const existing = loadPracticeRecords(userId);
  if (existing.some(r => r.id === record.id)) return true;

  const wrote = writePracticeRecords(userId, [record, ...existing]);

  getCurrentUserId().then(uid => {
    if (uid) saveReport(record, record.id, uid);
  }).catch(() => { /* offline — the local copy stands */ });

  return wrote;
}
