import { useState, useEffect } from 'react';
import { useExam, useExamDispatch } from '../context/ExamContext';
import { calculateTotalScore, getGrade } from '../utils/scoring';
import { saveReport } from '../services/reports';
import { incrementUserStats } from '../services/stats';
import { supabase } from '../lib/supabase';
import type { CheckingMode, HistoryRecord } from '../types';

const MODE_LABELS: Record<CheckingMode, { label: string; color: string }> = {
  easy: { label: 'Easy', color: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800' },
  medium: { label: 'Medium', color: 'text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800' },
  strict: { label: 'Strict', color: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800' },
};

export function ReportView({ userId = '' }: { userId?: string }) {
  const { answerKey, results, checkingMode, examTerm, examClass, studentName, studentSection, studentId, sessionId } = useExam();
  const dispatch = useExamDispatch();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showToast, setShowToast] = useState(false);

  const { scored, total, percentage } = calculateTotalScore(results);
  const grade = getGrade(percentage);

  // Auto-save to history once per session (stable across tab switches)
  useEffect(() => {
    if (!answerKey || results.length === 0 || !sessionId) return;

    const idsKey = userId ? `saved-session-ids-${userId}` : 'saved-session-ids';
    const savedIds: string[] = JSON.parse(localStorage.getItem(idsKey) ?? '[]');
    if (savedIds.includes(sessionId)) return;

    const record: HistoryRecord = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
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
    };

    // Persist to localStorage
    const histKey = userId ? `exam-history-${userId}` : 'exam-history';
    const existing: HistoryRecord[] = JSON.parse(localStorage.getItem(histKey) ?? '[]');
    localStorage.setItem(histKey, JSON.stringify([record, ...existing]));

    // Mark session as saved (keep last 100)
    const updated = [sessionId, ...savedIds].slice(0, 100);
    localStorage.setItem(idsKey, JSON.stringify(updated));

    // Persist to Supabase and record usage stats (fire-and-forget)
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (!uid) return;
        saveReport(record, sessionId, uid);
        const pages = results.filter(r => r.extractedText?.trim()).length;
        const words = results.reduce(
          (sum, r) => sum + (r.extractedText?.trim().split(/\s+/).filter(Boolean).length ?? 0),
          0,
        );
        incrementUserStats(uid, pages, words);
      });
    }

    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  }, [sessionId]);

  if (!answerKey) {
    return <div className="text-center text-slate-500 dark:text-zinc-400 py-16">No exam data to report.</div>;
  }

  const gradeColors: Record<string, string> = {
    'A+': 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    A: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    B: 'text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30',
    C: 'text-yellow-700 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30',
    D: 'text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
    F: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
  };

  const rowColors = {
    full: 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900',
    partial: 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-100 dark:border-yellow-900',
    zero: 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900',
    skipped: 'bg-slate-50 dark:bg-zinc-800/50 border-slate-100 dark:border-zinc-800',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Toast notification */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in flex items-center gap-2 print:hidden">
          <svg className="w-4 h-4 text-green-400 dark:text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Report saved to history
        </div>
      )}

      {/* ── PRINT-ONLY LAYOUT (hidden on screen) ─────────────────────────── */}
      <div className="hidden print:block text-black" style={{ fontFamily: 'serif' }}>
        {/* Heading: Exam title + Class */}
        <h1 style={{ fontSize: '20pt', fontWeight: 'bold', marginBottom: '4pt' }}>
          {answerKey.exam.title}{examClass ? ` — ${examClass}` : ''}
        </h1>

        {/* Student details */}
        <p style={{ fontSize: '11pt', marginBottom: '3pt', color: '#333' }}>
          {[
            studentName && `Student: ${studentName}`,
            studentId && `ID: ${studentId}`,
            studentSection && `Section: ${studentSection}`,
            examTerm && `Term: ${examTerm}`,
          ].filter(Boolean).join('  ·  ')}
        </p>

        {/* Marks + Grade */}
        <p style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '10pt' }}>
          Marks: {scored} / {total}  ({percentage}%)  —  Grade: {grade}
        </p>

        {/* Subject subheading */}
        {answerKey.exam.subject && (
          <p style={{ fontSize: '13pt', fontWeight: 'bold', marginBottom: '12pt', borderBottom: '1px solid #999', paddingBottom: '4pt' }}>
            {answerKey.exam.subject}
          </p>
        )}

        {/* Questions */}
        {answerKey.questions.map((q, idx) => {
          const result = results.find(r => r.questionId === q.id);
          return (
            <div key={q.id} style={{ marginBottom: '16pt', pageBreakInside: 'avoid' }}>
              <p style={{ fontSize: '11pt', fontWeight: 'bold', marginBottom: '3pt' }}>
                Q{idx + 1}. {q.question}
                <span style={{ fontWeight: 'normal', marginLeft: '8pt', color: '#555' }}>
                  [{result ? `${result.marksAwarded} / ${q.marks} marks` : `0 / ${q.marks} marks — skipped`}]
                </span>
              </p>
              {result?.extractedText ? (
                <div style={{ marginBottom: '4pt' }}>
                  <span style={{ fontSize: '9pt', textTransform: 'uppercase', color: '#666', letterSpacing: '0.05em' }}>Student's Answer: </span>
                  <span style={{ fontSize: '10pt' }}>{result.extractedText}</span>
                </div>
              ) : (
                <p style={{ fontSize: '10pt', color: '#999', fontStyle: 'italic', marginBottom: '4pt' }}>No answer provided.</p>
              )}
              <div>
                <span style={{ fontSize: '9pt', textTransform: 'uppercase', color: '#666', letterSpacing: '0.05em' }}>Expected Answer: </span>
                <span style={{ fontSize: '10pt', color: '#333' }}>{q.expectedAnswer}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── SCREEN-ONLY LAYOUT (hidden when printing) ────────────────────── */}
      <div className="print:hidden space-y-6">
        {/* Score card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-6">
          <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">{answerKey.exam.title}</h2>
              {(studentName || examClass || studentSection || examTerm) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-sm text-slate-500 dark:text-zinc-400">
                  {studentName && <span>{studentName}</span>}
                  {studentId && <span className="text-xs text-slate-400 dark:text-zinc-500">ID: {studentId}</span>}
                  {examClass && studentSection && <span>{examClass} · {studentSection}</span>}
                  {examTerm && <span>{examTerm}</span>}
                </div>
              )}
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${MODE_LABELS[checkingMode].color}`}>
              {MODE_LABELS[checkingMode].label} Checking
            </span>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="text-4xl font-bold text-gray-900 dark:text-zinc-100">
              {scored} <span className="text-slate-400 dark:text-zinc-500 text-2xl">/ {total}</span>
            </div>
            <div className="text-2xl font-semibold text-slate-600 dark:text-zinc-400">{percentage}%</div>
            <span className={`px-4 py-1 rounded-full text-xl font-bold ${gradeColors[grade] ?? 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300'}`}>
              {grade}
            </span>
          </div>
        </div>

        {/* Per-question breakdown */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
            <h3 className="font-semibold text-gray-800 dark:text-zinc-200">Question Breakdown</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-zinc-800">
            {answerKey.questions.map((q, idx) => {
              const result = results.find(r => r.questionId === q.id);
              const status = result?.status ?? 'skipped';
              const expanded = expandedId === q.id;
              return (
                <div key={q.id} className={`${rowColors[status]} border-b last:border-0`}>
                  <button className="w-full text-left px-5 py-3 flex items-center gap-4"
                    onClick={() => setExpandedId(expanded ? null : q.id)}>
                    <span className="text-xs font-semibold text-slate-400 dark:text-zinc-500 w-5">Q{idx + 1}</span>
                    <span className="flex-1 text-sm text-gray-800 dark:text-zinc-200 font-medium truncate">{q.question}</span>
                    {result && (
                      <>
                        <span className="text-xs text-slate-500 dark:text-zinc-400 w-20 text-right">{Math.round(result.similarityScore * 100)}% sim</span>
                        <span className="text-sm font-semibold w-16 text-right text-gray-800 dark:text-zinc-200">{result.marksAwarded} / {q.marks}</span>
                      </>
                    )}
                    {!result && <span className="text-xs text-slate-400 dark:text-zinc-500 italic">not graded</span>}
                  </button>
                  {expanded && result && (result.extractedText || q.expectedAnswer) && (
                    <div className="px-10 pb-4 space-y-2">
                      {result.extractedText && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-0.5">Student's Answer</p>
                          <p className="text-xs text-slate-700 dark:text-zinc-300 font-mono whitespace-pre-wrap bg-slate-50 dark:bg-zinc-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-zinc-700">{result.extractedText}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-0.5">Expected Answer</p>
                        <p className="text-xs text-slate-700 dark:text-zinc-300 font-mono whitespace-pre-wrap bg-slate-50 dark:bg-zinc-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-zinc-700">{q.expectedAnswer}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button onClick={() => window.print()}
            className="px-5 py-2.5 bg-zinc-800 dark:bg-zinc-700 text-white rounded-xl text-sm font-medium hover:bg-zinc-900 dark:hover:bg-zinc-600">
            Print / Save as PDF
          </button>
          <button onClick={() => dispatch({ type: 'RESET_SESSION' })}
            className="px-5 py-2.5 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700">
            New Exam
          </button>
        </div>
      </div>
    </div>
  );
}
