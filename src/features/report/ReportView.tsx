import { useState, useEffect, useRef } from 'react';
import { useExam, useExamDispatch } from '../../context/ExamContext';
import { calculateTotalScore, getGrade } from '../../utils/scoring';
import { saveReport } from '../../services/data/reports';
import { incrementUserStats } from '../../services/data/stats';
import { getCurrentUserId } from '../../services/data/supabase';
import { readJson, writeJson, storageKeys } from '../../services/storage';
import { MODE_LABELS, GRADE_PEN, STATUS_ROWS } from '../../config/constants';
import type { HistoryRecord } from '../../types';
import { printReport } from './printReport';
import { Badge, Button, Card, Icon } from '../../components/ui';

export function ReportView({ userId = '' }: { userId?: string }) {
  const { answerKey, results, checkingMode, examTerm, examClass, studentName, studentSection, studentId, sessionId } = useExam();
  const dispatch = useExamDispatch();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showToast, setShowToast] = useState(false);
  const recordRef = useRef<HistoryRecord | null>(null);

  const { scored, total, percentage } = calculateTotalScore(results);
  const grade = getGrade(percentage);

  // Build the record for this session (used for both saving and printing)
  const record: HistoryRecord | null = answerKey ? {
    id: recordRef.current?.id ?? crypto.randomUUID(),
    savedAt: recordRef.current?.savedAt ?? new Date().toISOString(),
    examTitle: answerKey.exam.title,
    subject: answerKey.exam.subject,
    term: examTerm,
    examClass,
    studentName,
    studentSection,
    studentId,
    checkingMode,
    scored,
    total,
    percentage,
    grade,
    questions: answerKey.questions,
    results,
  } : null;
  recordRef.current = record;

  // Auto-save to history once per session (stable across tab switches)
  useEffect(() => {
    if (!record || results.length === 0 || !sessionId) return;

    const idsKey = storageKeys.savedSessions(userId);
    const savedIds = readJson<string[]>(idsKey, []);
    if (savedIds.includes(sessionId)) return;

    const histKey = storageKeys.history(userId);
    const existing = readJson<HistoryRecord[]>(histKey, []);
    const wrote = writeJson(histKey, [record, ...existing]);
    if (wrote) {
      writeJson(idsKey, [sessionId, ...savedIds].slice(0, 100));
    }

    // Persist to Supabase + usage stats (fire-and-forget)
    getCurrentUserId().then(uid => {
      if (!uid) return;
      saveReport(record, sessionId, uid);
      const pages = results.filter(r => r.extractedText?.trim()).length;
      const words = results.reduce(
        (sum, r) => sum + (r.extractedText?.trim().split(/\s+/).filter(Boolean).length ?? 0),
        0,
      );
      incrementUserStats(uid, pages, words);
    });

    setShowToast(true);
    const t = setTimeout(() => setShowToast(false), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!answerKey || !record) {
    return (
      <Card>
        <div className="py-16 text-center text-ink-500 dark:text-ink-400 text-sm">No exam data to report.</div>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-ink-900 dark:bg-ink-100 text-white dark:text-ink-900 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in flex items-center gap-2 print:hidden">
          <Icon name="check" className="w-4 h-4 text-emerald-400 dark:text-emerald-600" strokeWidth={2.5} />
          Report saved to history
        </div>
      )}

      {/* Score card — styled like a marked cover sheet */}
      <Card className="p-6 relative overflow-visible bg-ruled">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap pr-24">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-100 tracking-tight">{answerKey.exam.title}</h2>
            {(studentName || examClass || studentSection || examTerm) && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-sm text-ink-500 dark:text-ink-400">
                {studentName && <span>{studentName}</span>}
                {studentId && <span className="text-xs text-ink-400 dark:text-ink-500">ID: {studentId}</span>}
                {examClass && studentSection && <span>{examClass} · {studentSection}</span>}
                {examTerm && <span>{examTerm}</span>}
              </div>
            )}
          </div>
          <Badge className={MODE_LABELS[checkingMode].badge}>
            {MODE_LABELS[checkingMode].label} Checking
          </Badge>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="font-display text-4xl font-semibold text-ink-900 dark:text-ink-100">
            {scored} <span className="text-ink-400 dark:text-ink-500 text-2xl">/ {total}</span>
          </div>
          <div className="font-display text-2xl font-semibold text-ink-600 dark:text-ink-400">{percentage}%</div>
        </div>

        {/* Circled hand-written grade, stamped in the corner */}
        <div
          className={`absolute -top-4 right-5 w-[4.5rem] h-[4.5rem] rounded-full border-[3px] bg-white/70 dark:bg-ink-900/70 backdrop-blur-[1px] flex items-center justify-center animate-stamp-in ${GRADE_PEN[grade] ?? 'text-ink-700 border-ink-400 dark:text-ink-300 dark:border-ink-500'}`}
          title={`Grade: ${grade}`}
        >
          <span className="font-hand text-4xl font-bold leading-none">{grade}</span>
        </div>
      </Card>

      {/* Per-question breakdown */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100 dark:border-ink-800">
          <h3 className="font-display font-semibold text-ink-800 dark:text-ink-200">Question Breakdown</h3>
        </div>
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {answerKey.questions.map((q, idx) => {
            const result = results.find(r => r.questionId === q.id);
            const status = result?.status ?? 'skipped';
            const expanded = expandedId === q.id;
            return (
              <div key={q.id} className={STATUS_ROWS[status]}>
                <button className="w-full text-left px-5 py-3 flex items-center gap-4"
                  onClick={() => setExpandedId(expanded ? null : q.id)}>
                  <span className="text-xs font-semibold text-ink-400 dark:text-ink-500 w-6">Q{idx + 1}</span>
                  <span className="flex-1 text-sm text-ink-800 dark:text-ink-200 font-medium truncate">{q.question}</span>
                  {result && (
                    <>
                      <span className="text-xs text-ink-500 dark:text-ink-400 w-20 text-right">{Math.round(result.similarityScore * 100)}% sim</span>
                      <span className="text-sm font-semibold w-16 text-right text-ink-800 dark:text-ink-200">{result.marksAwarded} / {q.marks}</span>
                    </>
                  )}
                  {!result && <span className="text-xs text-ink-400 dark:text-ink-500 italic">not graded</span>}
                </button>
                {expanded && result && (result.extractedText || q.expectedAnswer) && (
                  <div className="px-10 pb-4 space-y-2">
                    {result.extractedText && (
                      <div>
                        <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-0.5">Student's Answer</p>
                        <p className="text-xs text-ink-700 dark:text-ink-300 font-mono whitespace-pre-wrap bg-ink-50 dark:bg-ink-800 rounded-lg px-3 py-2 border border-ink-200 dark:border-ink-700">{result.extractedText}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-0.5">Expected Answer</p>
                      <p className="text-xs text-ink-700 dark:text-ink-300 font-mono whitespace-pre-wrap bg-ink-50 dark:bg-ink-800 rounded-lg px-3 py-2 border border-ink-200 dark:border-ink-700">{q.expectedAnswer}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon="print" onClick={() => printReport(record)}>
          Print / Save as PDF
        </Button>
        <Button variant="secondary" onClick={() => dispatch({ type: 'RESET_SESSION' })}>
          New Exam
        </Button>
      </div>
    </div>
  );
}
