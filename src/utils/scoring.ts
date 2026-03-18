import type { QuestionResult } from '../types';

export function calculateMarks(
  similarity: number,
  threshold: number,
  maxMarks: number
): { marks: number; status: QuestionResult['status'] } {
  if (similarity >= threshold) {
    return { marks: maxMarks, status: 'full' };
  }
  const partialThreshold = threshold * 0.7;
  if (similarity >= partialThreshold) {
    const range = threshold - partialThreshold;
    const progress = (similarity - partialThreshold) / range;
    const marks = Math.round(progress * maxMarks);
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
