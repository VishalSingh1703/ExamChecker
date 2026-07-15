import type { CheckingMode, QuestionResult } from '../types';

// ── Class / semester options (Setup, Question Bank, Paper Builder) ────────────

export const CLASS_OPTIONS = [
  { group: 'School Classes', options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
  { group: 'University Semesters', options: Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) },
] as const;

// ── Checking-mode labels + badge colours ──────────────────────────────────────

export const MODE_LABELS: Record<CheckingMode, { label: string; badge: string }> = {
  easy: { label: 'Easy', badge: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800' },
  medium: { label: 'Medium', badge: 'text-accent-700 dark:text-accent-400 bg-accent-50 dark:bg-accent-900/30 border-accent-200 dark:border-accent-800' },
  strict: { label: 'Strict', badge: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' },
};

export const CHECKING_MODES: CheckingMode[] = ['easy', 'medium', 'strict'];

// ── Grade + per-question status colours ───────────────────────────────────────

export const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30',
  A: 'text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30',
  B: 'text-accent-700 dark:text-accent-400 bg-accent-100 dark:bg-accent-900/30',
  C: 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30',
  D: 'text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
  F: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
};

/** Red-pen circled grade stamp colours (ReportView) — text + ring per grade. */
export const GRADE_PEN: Record<string, string> = {
  'A+': 'text-emerald-700 border-emerald-600/70 dark:text-emerald-400 dark:border-emerald-500/60',
  A: 'text-emerald-700 border-emerald-600/70 dark:text-emerald-400 dark:border-emerald-500/60',
  B: 'text-accent-700 border-accent-600/70 dark:text-accent-300 dark:border-accent-400/60',
  C: 'text-amber-700 border-amber-600/70 dark:text-amber-400 dark:border-amber-500/60',
  D: 'text-orange-700 border-orange-600/70 dark:text-orange-400 dark:border-orange-500/60',
  F: 'text-red-700 border-red-600/70 dark:text-red-400 dark:border-red-500/60',
};

export const STATUS_BADGES: Record<QuestionResult['status'], string> = {
  full: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  partial: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  zero: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  skipped: 'text-ink-600 dark:text-ink-400 bg-ink-50 dark:bg-ink-800 border-ink-200 dark:border-ink-700',
};

export const STATUS_ROWS: Record<QuestionResult['status'], string> = {
  full: 'bg-emerald-50/60 dark:bg-emerald-900/10',
  partial: 'bg-amber-50/60 dark:bg-amber-900/10',
  zero: 'bg-red-50/60 dark:bg-red-900/10',
  skipped: 'bg-ink-50 dark:bg-ink-800/50',
};

export const MAX_QUESTION_MARKS = 20;
