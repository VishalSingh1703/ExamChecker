import type { CheckingMode, QuestionResult } from '../types';

// ── Mode-driven mark calculation (new primary path) ───────────────────────────
//
// Medium  — exact 1:1 linear mapping.  60% similarity → 60% of marks.
// Strict  — penalty doubles the similarity gap.  For every 5% below 100%, lose
//            10% of marks.  Formula: ratio = max(0, 2·score − 1).
//            Breakeven at 50% similarity → 0 marks.
// Easy    — penalty is dampened.  For every 15% below 100%, lose 10% of marks.
//            Formula: ratio = max(0, 1 − (2/3)·(1−score)).
//            A score of 0 (completely blank/wrong) always awards 0 marks.

export function calculateMarksByMode(
  similarity: number,
  mode: CheckingMode,
  maxMarks: number,
): { marks: number; status: QuestionResult['status'] } {
  const s = Math.max(0, Math.min(1, similarity));

  let ratio: number;
  if (mode === 'medium') {
    ratio = s;
  } else if (mode === 'strict') {
    // -10% marks per -5% similarity  →  ratio = 2s − 1
    ratio = Math.max(0, 2 * s - 1);
  } else {
    // easy: -10% marks per -15% similarity  →  ratio = 1 − (2/3)(1−s)
    // Special-case: truly blank/zero answer still gets 0.
    ratio = s <= 0 ? 0 : Math.max(0, 1 - (2 / 3) * (1 - s));
  }

  // Round to nearest 0.5 increment
  const marks = Math.round(ratio * maxMarks * 2) / 2;
  const status: QuestionResult['status'] =
    ratio === 0 ? 'zero'
    : marks >= maxMarks ? 'full'
    : 'partial';

  return { marks, status };
}

// ── Legacy threshold-based calculation (kept for QuestionGrader / HistoryView) -

export function calculateMarks(
  similarity: number,
  threshold: number,
  maxMarks: number
): { marks: number; status: QuestionResult['status'] } {
  if (similarity >= threshold) {
    return { marks: maxMarks, status: 'full' };
  }
  const partialThreshold = threshold * 0.4;
  if (similarity >= partialThreshold) {
    const range = threshold - partialThreshold;
    const progress = (similarity - partialThreshold) / range;
    const marks = Math.max(1, Math.round(progress * maxMarks));
    return { marks, status: 'partial' };
  }
  return { marks: 0, status: 'zero' };
}

export function calculateTotalScore(results: QuestionResult[]): {
  scored: number;
  total: number;
  percentage: number;
} {
  const scored = results.reduce((sum, r) => sum + r.marksAwarded, 0);
  const total = results.reduce((sum, r) => sum + r.maxMarks, 0);
  const percentage = total > 0 ? Math.round((scored / total) * 100) : 0;
  return { scored, total, percentage };
}

export function getGrade(percentage: number): string {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D';
  return 'F';
}
