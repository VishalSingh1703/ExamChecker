import { useState, useRef, useEffect, useCallback } from 'react';
import { useExam, useExamDispatch } from '../context/ExamContext';
import { segmentAndGradeAll, gradeExtractedText } from '../services/ocr';
import type { SheetPage } from '../services/ocr';
import { extractPagesFromVideo } from '../services/videoExtractor';
import type { VideoExtractionProgress } from '../services/videoExtractor';
import { calculateMarksByMode } from '../utils/scoring';
import type { QuestionResult } from '../types';


const statusColors = {
  full: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  partial: 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  zero: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  skipped: 'text-slate-600 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700',
};

type QResult = {
  extractedText: string;
  score: number;
  marks: number;
  status: QuestionResult['status'];
  notFound: boolean;
};

export function GradingView() {
  const { answerKey, geminiApiKey, checkingMode, examTerm, examClass, studentName, studentSection } = useExam();
  const dispatch = useExamDispatch();

  const [uploadMode, setUploadMode] = useState<'images' | 'video'>('images');
  const [pages, setPages] = useState<SheetPage[]>([]);
  const [skippedQuestions, setSkippedQuestions] = useState<Set<number>>(new Set());
  const [batchResults, setBatchResults] = useState<Record<number, QResult> | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState('');
  const [reEvalLoading, setReEvalLoading] = useState<number | null>(null);
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);
  const evalAbortRef = useRef<AbortController | null>(null);
  const [reorderWarning, setReorderWarning] = useState(false);

  // Video extraction state
  const [videoFile, setVideoFile] = useState<{ file: File; url: string } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<VideoExtractionProgress | null>(null);
  const [extractError, setExtractError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  // Keep a ref to the latest pages so the cleanup function always sees current URLs
  const pagesRef = useRef(pages);
  const videoFileRef = useRef(videoFile);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { videoFileRef.current = videoFile; }, [videoFile]);

  // Revoke all object URLs on unmount
  useEffect(() => {
    return () => {
      pagesRef.current.forEach(p => URL.revokeObjectURL(p.url));
      if (videoFileRef.current) URL.revokeObjectURL(videoFileRef.current.url);
    };
  }, []);

  if (!answerKey) {
    return (
      <div className="text-center text-slate-500 dark:text-zinc-400 py-16">
        No answer key loaded. Go to Setup first.
      </div>
    );
  }

  const questions = answerKey.questions;

  // ── Page management ─────────────────────────────────────────────────────────

  function addPages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newPages: SheetPage[] = Array.from(files).map(f => ({
      id: crypto.randomUUID(),
      file: f,
      url: URL.createObjectURL(f),
    }));
    setPages(prev => [...prev, ...newPages]);
    if (batchResults) { setBatchResults(null); setReorderWarning(false); }
  }

  function removePage(index: number) {
    setPages(prev => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
    if (batchResults) { setBatchResults(null); setReorderWarning(false); }
  }

  function movePage(index: number, direction: 'up' | 'down') {
    setPages(prev => {
      const next = [...prev];
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
    if (batchResults) setReorderWarning(true);
  }

  // Add pages from a plain File[] (used after video extraction)
  function addPagesFromArray(files: File[]) {
    if (files.length === 0) return;
    const newPages: SheetPage[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      url: URL.createObjectURL(f),
    }));
    setPages(prev => [...prev, ...newPages]);
    if (batchResults) { setBatchResults(null); setReorderWarning(false); }
  }

  // ── Video handlers ───────────────────────────────────────────────────────────

  function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (videoFile) URL.revokeObjectURL(videoFile.url);
    setVideoFile({ file: f, url: URL.createObjectURL(f) });
    setExtractError('');
    setExtractProgress(null);
  }

  function clearVideo() {
    if (videoFile) URL.revokeObjectURL(videoFile.url);
    setVideoFile(null);
    setExtractProgress(null);
    setExtractError('');
  }

  async function handleExtractPages() {
    if (!videoFile) return;
    setExtracting(true);
    setExtractError('');
    setExtractProgress(null);
    try {
      const files = await extractPagesFromVideo(videoFile.file, (p) => setExtractProgress(p));
      if (files.length === 0) {
        setExtractError('No stable pages detected. Try flipping slower, or switch to image upload.');
        setExtracting(false);
        return;
      }
      addPagesFromArray(files);
      clearVideo();
      setUploadMode('images'); // switch to page list view so user can review
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Extraction failed.');
    }
    setExtracting(false);
  }

  // ── Skip toggle ─────────────────────────────────────────────────────────────

  function toggleSkip(questionId: number) {
    setSkippedQuestions(prev => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  // ── Evaluate all ────────────────────────────────────────────────────────────

  async function handleEvaluateAll() {
    if (!geminiApiKey?.trim()) {
      setEvalError('AI API key is required. Add it in Setup.');
      return;
    }
    if (pages.length === 0 && skippedQuestions.size === 0) {
      setEvalError('Upload at least one page to evaluate.');
      return;
    }
    // Cancel any in-flight evaluation
    evalAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    evalAbortRef.current = abortCtrl;

    setEvaluating(true);
    setEvalError('');
    setReorderWarning(false);
    try {
      const inputs = questions
        .filter(q => !skippedQuestions.has(q.id))
        .map(q => ({
          id: q.id,
          question: q.question,
          expectedAnswer: q.expectedAnswer,
          keywords: q.keywords ?? [],
          marks: q.marks,
        }));

      const raw = inputs.length > 0 && pages.length > 0
        ? await segmentAndGradeAll(pages, inputs, geminiApiKey.trim(), abortCtrl.signal)
        : [];

      const map: Record<number, QResult> = {};
      for (const q of questions) {
        if (skippedQuestions.has(q.id)) {
          map[q.id] = { extractedText: '', score: 0, marks: 0, status: 'skipped', notFound: false };
        } else {
          const r = raw.find(x => x.questionId === q.id);
          if (!r || r.notFound) {
            map[q.id] = { extractedText: '', score: 0, marks: 0, status: 'zero', notFound: true };
          } else {
            const { marks, status } = calculateMarksByMode(r.score, checkingMode, q.marks);
            map[q.id] = { extractedText: r.extractedText, score: r.score, marks, status, notFound: false };
          }
        }
      }
      setBatchResults(map);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // user navigated away — silently discard
      setEvalError(e instanceof Error ? e.message : 'Evaluation failed. Please try again.');
    }
    setEvaluating(false);
  }

  // ── Re-evaluate single question (text only — no OCR) ───────────────────────

  async function handleReEvaluate(questionId: number) {
    const q = questions.find(x => x.id === questionId);
    const current = batchResults?.[questionId];
    if (!q || !geminiApiKey?.trim() || !current) return;
    setReEvalLoading(questionId);
    const ac = new AbortController();
    try {
      const [r] = await gradeExtractedText(
        [{
          id: q.id,
          question: q.question,
          expectedAnswer: q.expectedAnswer,
          keywords: q.keywords ?? [],
          marks: q.marks,
          extractedText: current.extractedText,
        }],
        geminiApiKey.trim(),
        ac.signal,
      );
      const { marks, status } = calculateMarksByMode(r.score, checkingMode, q.marks);
      setBatchResults(prev => prev ? {
        ...prev,
        [questionId]: { ...prev[questionId], score: r.score, marks, status, notFound: false },
      } : prev);
    } catch {
      // keep existing result on error
    }
    setReEvalLoading(null);
  }

  // ── Generate report ─────────────────────────────────────────────────────────

  function handleGenerateReport() {
    if (!batchResults) return;
    for (const q of questions) {
      const r = batchResults[q.id] ?? { extractedText: '', score: 0, marks: 0, status: 'skipped' as const, notFound: false };
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

  const closeLightbox = useCallback(() => setLightboxPage(null), []);

  // Close lightbox on Escape key
  useEffect(() => {
    if (lightboxPage === null) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxPage, closeLightbox]);

  const allEvaluated = batchResults !== null && questions.every(q => batchResults[q.id] !== undefined);
  const canEvaluate = pages.length > 0 || skippedQuestions.size > 0;

  return (
    <>
      {/* Lightbox */}
      {lightboxPage !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center"
          onClick={closeLightbox}
        >
          <div className="relative w-full max-w-3xl px-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={closeLightbox}
              className="absolute -top-10 right-4 text-white text-2xl font-bold hover:text-zinc-300"
            >✕</button>
            <img
              src={pages[lightboxPage]?.url}
              alt={`Page ${lightboxPage + 1}`}
              className="w-full max-h-[82vh] object-contain rounded-xl"
            />
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={() => setLightboxPage(p => p !== null && p > 0 ? p - 1 : p)}
                disabled={lightboxPage === 0}
                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm disabled:opacity-30 hover:bg-white/30"
              >← Prev</button>
              <span className="text-white text-sm">Page {lightboxPage + 1} of {pages.length}</span>
              <button
                onClick={() => setLightboxPage(p => p !== null && p < pages.length - 1 ? p + 1 : p)}
                disabled={lightboxPage === pages.length - 1}
                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm disabled:opacity-30 hover:bg-white/30"
              >Next →</button>
            </div>
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
            1 · Upload Pages
          </span>
          <span className="text-slate-300 dark:text-zinc-600">→</span>
          <span className={`font-medium ${evaluating ? 'text-purple-700 dark:text-purple-400' : 'text-slate-400 dark:text-zinc-600'}`}>
            2 · Evaluate
          </span>
          <span className="text-slate-300 dark:text-zinc-600">→</span>
          <span className={`font-medium ${allEvaluated ? 'text-purple-700 dark:text-purple-400' : 'text-slate-400 dark:text-zinc-600'}`}>
            3 · Generate Report
          </span>
          <span className="ml-auto text-xs text-slate-400 dark:text-zinc-500">
            {pages.length} page{pages.length !== 1 ? 's' : ''}
            {skippedQuestions.size > 0 && ` · ${skippedQuestions.size} skipped`}
          </span>
        </div>

        {/* ── Upload panel ────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 overflow-hidden">

          {/* Header + mode toggle */}
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-zinc-800 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Answer Sheet</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                {uploadMode === 'images'
                  ? 'Upload pages in order — AI will read, segment by question label, and grade.'
                  : 'Record a video slowly flipping through all pages — AI extracts each page automatically.'}
              </p>
            </div>
            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-zinc-700 flex-shrink-0 text-xs font-semibold">
              <button
                onClick={() => setUploadMode('images')}
                className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                  uploadMode === 'images'
                    ? 'bg-purple-700 text-white'
                    : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V9.75" />
                </svg>
                Images
              </button>
              <button
                onClick={() => setUploadMode('video')}
                className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors border-l border-slate-200 dark:border-zinc-700 ${
                  uploadMode === 'video'
                    ? 'bg-purple-700 text-white'
                    : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Video
              </button>
            </div>
          </div>

          {/* ── Image mode ── */}
          {uploadMode === 'images' && (<>
            {pages.length === 0 ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-3 py-12 px-5 text-slate-400 dark:text-zinc-500 hover:text-purple-700 dark:hover:text-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors"
              >
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V9.75M8.25 9h.008v.008H8.25V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-semibold">Tap to upload answer sheet pages</p>
                  <p className="text-xs mt-1">Select all pages at once · Reorder below if needed</p>
                </div>
              </button>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-zinc-800 max-h-[65vh] overflow-y-auto">
                {pages.map((page, i) => (
                  <div key={page.id} className="flex items-start gap-3 px-4 py-3">
                    <img
                      src={page.url}
                      alt={`Page ${i + 1}`}
                      onClick={() => setLightboxPage(i)}
                      className="w-20 h-24 object-cover rounded-lg border border-slate-200 dark:border-zinc-700 cursor-pointer hover:opacity-80 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100">Page {i + 1}</p>
                      <p className="text-xs text-slate-400 dark:text-zinc-500 truncate mt-0.5">{page.file.name}</p>
                      <button onClick={() => setLightboxPage(i)} className="text-xs text-purple-600 dark:text-purple-400 hover:underline mt-1">
                        View full size
                      </button>
                    </div>
                    <div className="flex flex-col items-center gap-1 pt-1 flex-shrink-0">
                      <button onClick={() => movePage(i, 'up')} disabled={i === 0} title="Move up"
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors text-sm font-bold">▲</button>
                      <button onClick={() => movePage(i, 'down')} disabled={i === pages.length - 1} title="Move down"
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors text-sm font-bold">▼</button>
                      <button onClick={() => removePage(i)} title="Remove"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-5 py-3 border-t border-slate-100 dark:border-zinc-800">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-500 dark:text-zinc-400 hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-700 dark:hover:text-purple-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {pages.length === 0 ? 'Upload Pages' : 'Add More Pages'}
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { addPages(e.target.files); e.target.value = ''; }} />
          </>)}

          {/* ── Video mode ── */}
          {uploadMode === 'video' && (
            <div className="p-5 space-y-4">
              {/* Tip */}
              <div className="flex items-start gap-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3 text-xs text-indigo-700 dark:text-indigo-300">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Record a slow, steady video flipping through each page of the answer sheet. Hold each page still for 1–2 seconds before turning. Pages are auto-detected and extracted.</span>
              </div>

              {!videoFile ? (
                /* Video drop zone */
                <button
                  onClick={() => videoInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-3 py-12 border-2 border-dashed border-slate-200 dark:border-zinc-700 rounded-xl text-slate-400 dark:text-zinc-500 hover:border-purple-400 dark:hover:border-purple-600 hover:text-purple-700 dark:hover:text-purple-400 transition-colors"
                >
                  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-semibold">Tap to select video</p>
                    <p className="text-xs mt-1">MP4, MOV, or WebM</p>
                  </div>
                </button>
              ) : !extracting ? (
                /* Video selected — preview + extract button */
                <div className="space-y-3">
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
                    <svg className="w-8 h-8 text-purple-600 dark:text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100 truncate">{videoFile.file.name}</p>
                      <p className="text-xs text-slate-400 dark:text-zinc-500">
                        {(videoFile.file.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                    <button onClick={clearVideo} className="text-slate-400 hover:text-red-500 transition-colors text-sm">✕</button>
                  </div>
                  <video
                    src={videoFile.url}
                    controls
                    muted
                    playsInline
                    className="w-full max-h-48 rounded-xl object-contain bg-black"
                  />
                  <button
                    onClick={handleExtractPages}
                    className="w-full py-3 bg-purple-700 text-white rounded-xl text-sm font-semibold hover:bg-purple-800 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    Extract Pages from Video
                  </button>
                </div>
              ) : (
                /* Extracting — progress UI */
                <div className="space-y-4 py-4">
                  <div className="text-center">
                    <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100">
                      {extractProgress?.phase === 'capturing'
                        ? `Extracting ${extractProgress.pagesFound} page${extractProgress.pagesFound !== 1 ? 's' : ''} at full resolution…`
                        : `Scanning video for page turns${extractProgress?.pagesFound ? ` · ${extractProgress.pagesFound} found` : '…'}`}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">
                      {extractProgress?.phase === 'scanning'
                        ? 'Analysing motion to detect each stable page'
                        : 'Capturing high-quality frames'}
                    </p>
                  </div>
                  {/* Progress bar */}
                  <div className="bg-slate-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${extractProgress?.pct ?? 0}%` }}
                    />
                  </div>
                  <p className="text-center text-xs text-slate-400 dark:text-zinc-500">
                    {extractProgress?.pct ?? 0}%
                  </p>
                </div>
              )}

              {/* Error */}
              {extractError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
                  {extractError}
                </div>
              )}

              <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />
            </div>
          )}
        </div>

        {/* ── Skip questions panel ───────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-5 pt-3 pb-2 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">
              Mark unanswered questions
            </p>
            <span className="text-xs text-slate-400 dark:text-zinc-500">
              {skippedQuestions.size > 0 ? `${skippedQuestions.size} skipped` : 'All questions active'}
            </span>
          </div>
          <div className="px-5 py-3 flex flex-wrap gap-2">
            {questions.map((q, idx) => {
              const isSkipped = skippedQuestions.has(q.id);
              return (
                <button
                  key={q.id}
                  onClick={() => toggleSkip(q.id)}
                  title={isSkipped ? 'Click to unskip' : 'Click to mark as unanswered'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    isSkipped
                      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700'
                      : 'bg-slate-50 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-amber-300 dark:hover:border-amber-700 hover:text-amber-700 dark:hover:text-amber-400'
                  }`}
                >
                  {isSkipped ? '✕' : `Q${idx + 1}`}
                  <span className={isSkipped ? 'line-through opacity-60' : ''}>{isSkipped ? ` Q${idx + 1} skipped` : ` · ${q.marks}m`}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Reorder warning ────────────────────────────────────────────────── */}
        {reorderWarning && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            Page order changed — click <strong className="mx-1">Evaluate</strong> again to get updated results.
          </div>
        )}

        {/* ── Question result cards (after evaluation) ──────────────────────── */}
        {batchResults && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide px-1">
              Evaluation Results
            </p>
            {questions.map((q, idx) => {
              const result = batchResults[q.id];
              const isReEval = reEvalLoading === q.id;
              const isSkipped = skippedQuestions.has(q.id);
              if (!result) return null;

              return (
                <div key={q.id} className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  {/* Question header */}
                  <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-slate-100 dark:border-zinc-800">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium uppercase tracking-wide mb-1">
                        Q{idx + 1} · {q.marks} marks
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{q.question}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColors[result.status]}`}>
                      {isSkipped ? 'Skipped' : result.notFound ? 'Not found' : `${result.marks}/${q.marks} · ${Math.round(result.score * 100)}%`}
                    </span>
                  </div>

                  <div className="px-5 py-4 space-y-3">
                    {/* Not-found warning */}
                    {result.notFound && !isSkipped && (
                      <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                        <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                        </svg>
                        Answer not found on sheet — check page order or type the answer below, then Re-evaluate.
                      </div>
                    )}

                    {/* Extracted text */}
                    {!isSkipped && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">
                          Extracted Answer
                          <span className="ml-1.5 font-normal text-slate-400 dark:text-zinc-500">
                            (editable — correct any errors, then Re-evaluate)
                          </span>
                        </p>
                        <textarea
                          value={result.extractedText}
                          onChange={e => setBatchResults(prev => prev ? {
                            ...prev,
                            [q.id]: { ...prev[q.id], extractedText: e.target.value },
                          } : prev)}
                          rows={3}
                          placeholder="No text extracted — type the answer manually and click Re-evaluate."
                          className="w-full border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-y bg-slate-50 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600"
                        />
                        <div className="flex justify-end mt-1.5">
                          <button
                            onClick={() => handleReEvaluate(q.id)}
                            disabled={isReEval || !result.extractedText.trim()}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {isReEval && (
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            )}
                            {isReEval ? 'Re-evaluating…' : 'Re-evaluate'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

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
                  Reading pages · segmenting answers · grading…

                </>
              ) : pages.length === 0 ? (
                'Upload pages to evaluate'
              ) : (
                `Evaluate (${pages.length} page${pages.length !== 1 ? 's' : ''}${skippedQuestions.size > 0 ? ` · ${skippedQuestions.size} skipped` : ''})`
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
