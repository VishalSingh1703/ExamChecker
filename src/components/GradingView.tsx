import { useState, useRef } from 'react';
import { useExam, useExamDispatch } from '../context/ExamContext';
import { extractAndGradeAll } from '../services/ocr';
import { calculateMarks } from '../utils/scoring';
import type { CheckingMode, QuestionResult } from '../types';

const MODE_THRESHOLDS: Record<CheckingMode, number> = {
  easy: 0.45,
  medium: 0.6,
  strict: 0.75,
};

const statusColors = {
  full: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  partial: 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  zero: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  skipped: 'text-slate-600 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700',
};

type QImages = { files: File[]; urls: string[] };
type QResult = { extractedText: string; score: number; marks: number; status: QuestionResult['status'] };

export function GradingView() {
  const { answerKey, geminiApiKey, checkingMode, examTerm, examClass, studentName, studentSection } = useExam();
  const dispatch = useExamDispatch();
  const threshold = MODE_THRESHOLDS[checkingMode];

  const [questionImages, setQuestionImages] = useState<Record<number, QImages>>({});
  const [skippedQuestions, setSkippedQuestions] = useState<Set<number>>(new Set());
  const [batchResults, setBatchResults] = useState<Record<number, QResult> | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState('');
  const [viewModal, setViewModal] = useState<{ urls: string[]; page: number } | null>(null);
  const [reEvalLoading, setReEvalLoading] = useState<number | null>(null);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  if (!answerKey) {
    return (
      <div className="text-center text-slate-500 dark:text-zinc-400 py-16">
        No answer key loaded. Go to Setup first.
      </div>
    );
  }

  const questions = answerKey.questions;
  // ── Image helpers ──────────────────────────────────────────────────────────

  function addImages(questionId: number, newFiles: FileList | null) {
    if (!newFiles || newFiles.length === 0) return;
    const added = Array.from(newFiles);
    setQuestionImages(prev => {
      const existing = prev[questionId] ?? { files: [], urls: [] };
      const newUrls = added.map(f => URL.createObjectURL(f));
      return {
        ...prev,
        [questionId]: {
          files: [...existing.files, ...added],
          urls: [...existing.urls, ...newUrls],
        },
      };
    });
  }

  function toggleSkip(questionId: number) {
    setSkippedQuestions(prev => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
    // Clear any existing result for this question so it re-evaluates
    if (batchResults) {
      setBatchResults(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  }

  function removeImage(questionId: number, index: number) {
    setQuestionImages(prev => {
      const existing = prev[questionId];
      if (!existing) return prev;
      URL.revokeObjectURL(existing.urls[index]);
      const files = existing.files.filter((_, i) => i !== index);
      const urls = existing.urls.filter((_, i) => i !== index);
      if (files.length === 0) {
        const next = { ...prev };
        delete next[questionId];
        return next;
      }
      return { ...prev, [questionId]: { files, urls } };
    });
    if (batchResults) {
      setBatchResults(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  }

  // ── Evaluate all ───────────────────────────────────────────────────────────

  async function handleEvaluateAll() {
    if (!geminiApiKey?.trim()) {
      setEvalError('Gemini API key is required. Add it in Setup.');
      return;
    }
    setEvaluating(true);
    setEvalError('');
    try {
      const inputs = questions
        .filter(q => !skippedQuestions.has(q.id) && questionImages[q.id]?.files.length > 0)
        .map(q => ({
          id: q.id,
          question: q.question,
          expectedAnswer: q.expectedAnswer,
          keywords: q.keywords ?? [],
          marks: q.marks,
          images: questionImages[q.id].files,
        }));

      const raw = inputs.length > 0 ? await extractAndGradeAll(inputs, geminiApiKey.trim()) : [];

      const map: Record<number, QResult> = {};
      for (const q of questions) {
        if (skippedQuestions.has(q.id)) {
          map[q.id] = { extractedText: '', score: 0, marks: 0, status: 'skipped' };
        } else {
          const r = raw.find(x => x.questionId === q.id);
          if (!r) {
            map[q.id] = { extractedText: '', score: 0, marks: 0, status: 'skipped' };
          } else {
            const { marks, status } = calculateMarks(r.score, threshold, q.marks);
            map[q.id] = { extractedText: r.extractedText, score: r.score, marks, status };
          }
        }
      }
      setBatchResults(map);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : 'Evaluation failed. Please try again.');
    }
    setEvaluating(false);
  }

  // ── Re-evaluate single question ────────────────────────────────────────────

  async function handleReEvaluate(questionId: number) {
    const q = questions.find(x => x.id === questionId);
    if (!q || !geminiApiKey?.trim()) return;
    const images = questionImages[questionId]?.files ?? [];
    if (images.length === 0) return;
    setReEvalLoading(questionId);
    try {
      const [r] = await extractAndGradeAll(
        [{ id: q.id, question: q.question, expectedAnswer: q.expectedAnswer, keywords: q.keywords ?? [], marks: q.marks, images }],
        geminiApiKey.trim(),
      );
      const { marks, status } = calculateMarks(r.score, threshold, q.marks);
      setBatchResults(prev => ({
        ...prev,
        [questionId]: { extractedText: r.extractedText, score: r.score, marks, status },
      }));
    } catch {
      // keep existing result on error
    }
    setReEvalLoading(null);
  }

  // ── Generate report ────────────────────────────────────────────────────────

  function handleGenerateReport() {
    if (!batchResults) return;
    for (const q of questions) {
      const r = batchResults[q.id] ?? { extractedText: '', score: 0, marks: 0, status: 'skipped' as const };
      dispatch({
        type: 'UPDATE_QUESTION_RESULT',
        payload: {
          questionId: q.id,
          extractedText: r.extractedText,
          similarityScore: r.score,
          similarityMethod: 'semantic',
          marksAwarded: r.marks,
          maxMarks: q.marks,
          status: r.status,
        },
      });
    }
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'report' });
  }

  const activeQuestions = questions.filter(q => !skippedQuestions.has(q.id));
  const totalImages = activeQuestions.reduce((n, q) => n + (questionImages[q.id]?.files.length ?? 0), 0);
  const questionsWithImages = activeQuestions.filter(q => questionImages[q.id]?.files.length > 0).length;
  const canEvaluate = skippedQuestions.size > 0 || totalImages > 0;
  const allEvaluated = batchResults !== null && questions.every(q => batchResults[q.id] !== undefined);

  return (
    <>
      {/* Image lightbox modal */}
      {viewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center"
          onClick={() => setViewModal(null)}
        >
          <div className="relative w-full max-w-3xl px-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setViewModal(null)}
              className="absolute -top-10 right-4 text-white text-2xl font-bold hover:text-zinc-300"
            >
              ✕
            </button>
            <img
              src={viewModal.urls[viewModal.page]}
              alt={`Page ${viewModal.page + 1}`}
              className="w-full max-h-[80vh] object-contain rounded-xl"
            />
            {viewModal.urls.length > 1 && (
              <div className="flex items-center justify-center gap-4 mt-4">
                <button
                  onClick={() => setViewModal(v => v && v.page > 0 ? { ...v, page: v.page - 1 } : v)}
                  disabled={viewModal.page === 0}
                  className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm disabled:opacity-30 hover:bg-white/30"
                >
                  ← Prev
                </button>
                <span className="text-white text-sm">Page {viewModal.page + 1} of {viewModal.urls.length}</span>
                <button
                  onClick={() => setViewModal(v => v && v.page < v.urls.length - 1 ? { ...v, page: v.page + 1 } : v)}
                  disabled={viewModal.page === viewModal.urls.length - 1}
                  className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm disabled:opacity-30 hover:bg-white/30"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-4">
        {/* Student info bar */}
        {(studentName || examClass || studentSection || examTerm) && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 px-5 py-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-zinc-400">
            {examTerm && <span><span className="font-medium text-gray-800 dark:text-zinc-200">Term:</span> {examTerm}</span>}
            {examClass && <span><span className="font-medium text-gray-800 dark:text-zinc-200">Class:</span> {examClass}</span>}
            {studentSection && <span><span className="font-medium text-gray-800 dark:text-zinc-200">Section:</span> {studentSection}</span>}
            {studentName && <span><span className="font-medium text-gray-800 dark:text-zinc-200">Student:</span> {studentName}</span>}
          </div>
        )}

        {/* Phase indicator */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 px-5 py-3 flex items-center gap-3 text-sm">
          <span className={`font-medium ${!batchResults ? 'text-purple-700 dark:text-purple-400' : 'text-slate-400 dark:text-zinc-500'}`}>
            1 · Upload Images
          </span>
          <span className="text-slate-300 dark:text-zinc-600">→</span>
          <span className={`font-medium ${evaluating ? 'text-purple-700 dark:text-purple-400' : 'text-slate-400 dark:text-zinc-600'}`}>
            2 · Evaluate All
          </span>
          <span className="text-slate-300 dark:text-zinc-600">→</span>
          <span className={`font-medium ${allEvaluated ? 'text-purple-700 dark:text-purple-400' : 'text-slate-400 dark:text-zinc-600'}`}>
            3 · Generate Report
          </span>
          <span className="ml-auto text-xs text-slate-400 dark:text-zinc-500">
            {totalImages} image{totalImages !== 1 ? 's' : ''} · {questionsWithImages}/{activeQuestions.length} answered
            {skippedQuestions.size > 0 && ` · ${skippedQuestions.size} skipped`}
          </span>
        </div>

        {/* Question cards */}
        {questions.map((q, idx) => {
          const imgs = questionImages[q.id];
          const result = batchResults?.[q.id];
          const isReEval = reEvalLoading === q.id;
          const isSkipped = skippedQuestions.has(q.id);

          return (
            <div key={q.id} className={`bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border overflow-hidden ${isSkipped ? 'border-slate-200 dark:border-zinc-700 opacity-60' : 'border-slate-200 dark:border-zinc-800'}`}>
              {/* Question header */}
              <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-slate-100 dark:border-zinc-800">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium uppercase tracking-wide mb-1">
                    Question {idx + 1} of {questions.length}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{q.question}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-1">
                    {q.marks} marks
                  </span>
                  <button
                    onClick={() => toggleSkip(q.id)}
                    title={isSkipped ? 'Student answered this question — click to unskip' : 'Student did not answer — click to skip'}
                    className={`text-xs font-medium px-3 py-1 rounded-lg border transition-colors ${
                      isSkipped
                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                        : 'bg-slate-50 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 border-slate-200 dark:border-zinc-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800'
                    }`}
                  >
                    {isSkipped ? '↩ Unskip' : 'Skip'}
                  </button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                {isSkipped ? (
                  /* Skipped state */
                  <div className="flex items-center gap-2 py-2 text-sm text-amber-700 dark:text-amber-400">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Student did not answer this question — will be marked as 0.
                  </div>
                ) : (
                  <>
                    {/* Upload area */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => fileRefs.current[q.id]?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-500 dark:text-zinc-400 hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-700 dark:hover:text-purple-400"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          {imgs ? 'Add More Images' : 'Upload Image(s)'}
                        </button>
                        <input
                          ref={el => { fileRefs.current[q.id] = el; }}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={e => { addImages(q.id, e.target.files); e.target.value = ''; }}
                        />
                        {imgs && (
                          <button
                            onClick={() => setViewModal({ urls: imgs.urls, page: 0 })}
                            className="text-xs text-purple-700 dark:text-purple-400 hover:underline"
                          >
                            View Images ({imgs.files.length})
                          </button>
                        )}
                      </div>

                      {/* Thumbnails */}
                      {imgs && imgs.urls.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {imgs.urls.map((url, i) => (
                            <div key={i} className="relative group">
                              <img
                                src={url}
                                alt={`Page ${i + 1}`}
                                onClick={() => setViewModal({ urls: imgs.urls, page: i })}
                                className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-zinc-700 cursor-pointer hover:opacity-80"
                              />
                              <span className="absolute bottom-0.5 left-0.5 text-xs bg-black/50 text-white rounded px-1 leading-tight">
                                {i + 1}
                              </span>
                              <button
                                onClick={() => removeImage(q.id, i)}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Result panel (shown after evaluation) */}
                {result && (
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusColors[result.status]}`}>
                        {result.marks} / {q.marks} marks · {Math.round(result.score * 100)}% · {result.status}
                      </span>
                      {!isSkipped && imgs && imgs.files.length > 0 && (
                        <button
                          onClick={() => handleReEvaluate(q.id)}
                          disabled={isReEval}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                        >
                          {isReEval ? 'Re-evaluating…' : 'Re-evaluate'}
                        </button>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">
                        Extracted Text{result.status === 'skipped' ? ' (no image uploaded — skipped)' : ''}
                      </p>
                      <textarea
                        value={result.extractedText}
                        onChange={e => setBatchResults(prev => prev ? {
                          ...prev,
                          [q.id]: { ...prev[q.id], extractedText: e.target.value },
                        } : prev)}
                        rows={3}
                        placeholder="No text extracted"
                        className="w-full border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-none bg-slate-50 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Error */}
        {evalError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {evalError}
          </div>
        )}

        {/* Bottom action bar */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 px-5 py-4">
          {!allEvaluated ? (
            <button
              onClick={handleEvaluateAll}
              disabled={evaluating || !canEvaluate}
              className="w-full py-3 bg-purple-700 text-white rounded-xl text-sm font-semibold hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {evaluating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Evaluating all questions…
                </>
              ) : (
                `Evaluate All  (${questionsWithImages} answered${skippedQuestions.size > 0 ? ` · ${skippedQuestions.size} skipped` : ''} / ${questions.length} questions)`
              )}
            </button>
          ) : (
            <button
              onClick={handleGenerateReport}
              className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Generate Report
            </button>
          )}
        </div>
      </div>
    </>
  );
}
