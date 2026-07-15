import { useState, useRef, useEffect, useCallback } from 'react';
import { useExam, useExamDispatch } from '../../context/ExamContext';
import { segmentAndGradeAll, gradeExtractedText, type SheetPage } from '../../services/ai/grading';
import { extractPagesFromVideo, type VideoExtractionProgress } from '../../services/media/videoExtractor';
import { calculateMarksByMode } from '../../utils/scoring';
import { STATUS_BADGES } from '../../config/constants';
import type { QuestionResult } from '../../types';
import { Alert, Badge, Button, Card, Icon, ProgressBar, Spinner } from '../../components/ui';

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
  const [reEvalError, setReEvalError] = useState('');
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
  // Refs mirror the latest URLs so the unmount cleanup revokes them all
  const pagesRef = useRef(pages);
  const videoFileRef = useRef(videoFile);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { videoFileRef.current = videoFile; }, [videoFile]);

  useEffect(() => {
    return () => {
      pagesRef.current.forEach(p => URL.revokeObjectURL(p.url));
      if (videoFileRef.current) URL.revokeObjectURL(videoFileRef.current.url);
      evalAbortRef.current?.abort();
    };
  }, []);

  const closeLightbox = useCallback(() => setLightboxPage(null), []);

  useEffect(() => {
    if (lightboxPage === null) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxPage, closeLightbox]);

  if (!answerKey) {
    return (
      <Card>
        <div className="py-16 text-center text-zinc-500 dark:text-zinc-400 text-sm">
          No answer key loaded. Go to <span className="font-semibold">Setup</span> first.
        </div>
      </Card>
    );
  }

  const questions = answerKey.questions;

  // ── Page management ─────────────────────────────────────────────────────────

  function invalidateResults() {
    if (batchResults) { setBatchResults(null); setReorderWarning(false); }
  }

  function addPagesFromArray(files: File[]) {
    if (files.length === 0) return;
    const newPages: SheetPage[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      url: URL.createObjectURL(f),
    }));
    setPages(prev => [...prev, ...newPages]);
    invalidateResults();
  }

  function removePage(index: number) {
    setPages(prev => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
    invalidateResults();
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

  // ── Video handlers ──────────────────────────────────────────────────────────

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
      setUploadMode('images');
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
    evalAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    evalAbortRef.current = abortCtrl;

    setEvaluating(true);
    setEvalError('');
    setReEvalError('');
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
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setEvalError(e instanceof Error ? e.message : 'Evaluation failed. Please try again.');
      }
    } finally {
      setEvaluating(false);
    }
  }

  // ── Re-evaluate a single question (text-only) ───────────────────────────────

  async function handleReEvaluate(questionId: number) {
    const q = questions.find(x => x.id === questionId);
    const current = batchResults?.[questionId];
    if (!q || !geminiApiKey?.trim() || !current) return;
    setReEvalLoading(questionId);
    setReEvalError('');
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
      );
      const { marks, status } = calculateMarksByMode(r.score, checkingMode, q.marks);
      setBatchResults(prev => prev ? {
        ...prev,
        [questionId]: { ...prev[questionId], score: r.score, marks, status, notFound: false },
      } : prev);
    } catch (e) {
      setReEvalError(e instanceof Error ? e.message : 'Re-evaluation failed — the previous result was kept.');
    } finally {
      setReEvalLoading(null);
    }
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

  const allEvaluated = batchResults !== null && questions.every(q => batchResults[q.id] !== undefined);
  const canEvaluate = pages.length > 0 || skippedQuestions.size > 0;

  const modeToggle = (mode: 'images' | 'video', icon: 'image' | 'video', label: string, extraCls = '') => (
    <button
      onClick={() => setUploadMode(mode)}
      className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${extraCls} ${
        uploadMode === mode
          ? 'bg-purple-700 text-white'
          : 'bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
      }`}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      {label}
    </button>
  );

  return (
    <>
      {/* ── Lightbox ─────────────────────────────────────────────────────────── */}
      {lightboxPage !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center"
          onClick={closeLightbox}
        >
          <div className="relative w-full max-w-3xl px-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={closeLightbox}
              className="absolute -top-10 right-4 text-white text-2xl font-bold hover:text-zinc-300"
              aria-label="Close preview"
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

      <div className="max-w-4xl mx-auto space-y-4 animate-fade-in">
        {/* Student info bar */}
        {(studentName || examClass || studentSection || examTerm) && (
          <Card className="px-5 py-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {examTerm && <span><span className="font-medium text-zinc-800 dark:text-zinc-200">Term:</span> {examTerm}</span>}
            {examClass && <span><span className="font-medium text-zinc-800 dark:text-zinc-200">Class:</span> {examClass}</span>}
            {studentSection && <span><span className="font-medium text-zinc-800 dark:text-zinc-200">Section:</span> {studentSection}</span>}
            {studentName && <span><span className="font-medium text-zinc-800 dark:text-zinc-200">Student:</span> {studentName}</span>}
          </Card>
        )}

        {/* Phase indicator */}
        <Card className="px-5 py-3 flex items-center gap-3 text-sm">
          <span className={`font-medium ${!batchResults ? 'text-purple-700 dark:text-purple-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
            1 · Upload
          </span>
          <span className="text-zinc-300 dark:text-zinc-600">→</span>
          <span className={`font-medium ${evaluating ? 'text-purple-700 dark:text-purple-400' : 'text-zinc-400 dark:text-zinc-600'}`}>
            2 · Evaluate
          </span>
          <span className="text-zinc-300 dark:text-zinc-600">→</span>
          <span className={`font-medium ${allEvaluated ? 'text-purple-700 dark:text-purple-400' : 'text-zinc-400 dark:text-zinc-600'}`}>
            3 · Report
          </span>
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
            {pages.length} page{pages.length !== 1 ? 's' : ''}
            {skippedQuestions.size > 0 && ` · ${skippedQuestions.size} skipped`}
          </span>
        </Card>

        {/* ── Upload panel ─────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Answer Sheet</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {uploadMode === 'images'
                  ? 'Upload pages in order — AI will read, segment by question label, and grade.'
                  : 'Record a slow flip-through video — AI extracts each page automatically.'}
              </p>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 flex-shrink-0 text-xs font-semibold">
              {modeToggle('images', 'image', 'Images')}
              {modeToggle('video', 'video', 'Video', 'border-l border-zinc-200 dark:border-zinc-700')}
            </div>
          </div>

          {/* ── Image mode ── */}
          {uploadMode === 'images' && (<>
            {pages.length === 0 ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-3 py-12 px-5 text-zinc-400 dark:text-zinc-500 hover:text-purple-700 dark:hover:text-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors"
              >
                <Icon name="image" className="w-10 h-10" strokeWidth={1.5} />
                <div className="text-center">
                  <p className="text-sm font-semibold">Tap to upload answer sheet pages</p>
                  <p className="text-xs mt-1">Select all pages at once · Reorder below if needed</p>
                </div>
              </button>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[65vh] overflow-y-auto">
                {pages.map((page, i) => (
                  <div key={page.id} className="flex items-start gap-3 px-4 py-3">
                    <img
                      src={page.url}
                      alt={`Page ${i + 1}`}
                      onClick={() => setLightboxPage(i)}
                      loading="lazy"
                      className="w-20 h-24 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:opacity-80 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Page {i + 1}</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{page.file.name}</p>
                      <button onClick={() => setLightboxPage(i)} className="text-xs text-purple-600 dark:text-purple-400 hover:underline mt-1">
                        View full size
                      </button>
                    </div>
                    <div className="flex flex-col items-center gap-1 pt-1 flex-shrink-0">
                      <button onClick={() => movePage(i, 'up')} disabled={i === 0} title="Move up" aria-label={`Move page ${i + 1} up`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                        <Icon name="chevronUp" className="w-4 h-4" />
                      </button>
                      <button onClick={() => movePage(i, 'down')} disabled={i === pages.length - 1} title="Move down" aria-label={`Move page ${i + 1} down`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                        <Icon name="chevronDown" className="w-4 h-4" />
                      </button>
                      <button onClick={() => removePage(i)} title="Remove" aria-label={`Remove page ${i + 1}`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Icon name="x" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-500 dark:text-zinc-400 hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-700 dark:hover:text-purple-400 transition-colors"
              >
                <Icon name="plus" className="w-4 h-4" />
                {pages.length === 0 ? 'Upload Pages' : 'Add More Pages'}
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { addPagesFromArray(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </>)}

          {/* ── Video mode ── */}
          {uploadMode === 'video' && (
            <div className="p-5 space-y-4">
              <Alert tone="info">
                Record a slow, steady video flipping through each page of the answer sheet. Hold each page still for 1–2 seconds before turning. Pages are auto-detected and extracted.
              </Alert>

              {!videoFile ? (
                <button
                  onClick={() => videoInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-3 py-12 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-400 dark:text-zinc-500 hover:border-purple-400 dark:hover:border-purple-600 hover:text-purple-700 dark:hover:text-purple-400 transition-colors"
                >
                  <Icon name="video" className="w-12 h-12" strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="text-sm font-semibold">Tap to select video</p>
                    <p className="text-xs mt-1">MP4, MOV, or WebM</p>
                  </div>
                </button>
              ) : !extracting ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
                    <Icon name="video" className="w-8 h-8 text-purple-600 dark:text-purple-400 flex-shrink-0" strokeWidth={1.5} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">{videoFile.file.name}</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        {(videoFile.file.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                    <button onClick={clearVideo} className="text-zinc-400 hover:text-red-500 transition-colors text-sm" aria-label="Remove video">✕</button>
                  </div>
                  <video
                    src={videoFile.url}
                    controls
                    muted
                    playsInline
                    className="w-full max-h-48 rounded-xl object-contain bg-black"
                  />
                  <Button className="w-full py-3" icon="sparkles" onClick={handleExtractPages}>
                    Extract Pages from Video
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="text-center">
                    <Spinner className="w-8 h-8 mx-auto mb-3 text-purple-600 dark:text-purple-400" />
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      {extractProgress?.phase === 'capturing'
                        ? `Extracting ${extractProgress.pagesFound} page${extractProgress.pagesFound !== 1 ? 's' : ''} at full resolution…`
                        : `Scanning video for page turns${extractProgress?.pagesFound ? ` · ${extractProgress.pagesFound} found` : '…'}`}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                      {extractProgress?.phase === 'scanning'
                        ? 'Analysing motion to detect each stable page'
                        : 'Capturing high-quality frames'}
                    </p>
                  </div>
                  <ProgressBar pct={extractProgress?.pct ?? 0} />
                  <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
                    {extractProgress?.pct ?? 0}%
                  </p>
                </div>
              )}

              {extractError && <Alert tone="error">{extractError}</Alert>}

              <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />
            </div>
          )}
        </Card>

        {/* ── Skip questions panel ─────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="px-5 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Mark unanswered questions
            </p>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
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
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-amber-300 dark:hover:border-amber-700 hover:text-amber-700 dark:hover:text-amber-400'
                  }`}
                >
                  {isSkipped ? <span className="line-through opacity-60">Q{idx + 1} skipped</span> : `Q${idx + 1} · ${q.marks}m`}
                </button>
              );
            })}
          </div>
        </Card>

        {/* ── Reorder warning ─────────────────────────────────────────────── */}
        {reorderWarning && (
          <Alert tone="warning">
            Page order changed — click <strong className="mx-1">Evaluate</strong> again to get updated results.
          </Alert>
        )}

        {/* ── Result cards ─────────────────────────────────────────────────── */}
        {batchResults && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide px-1">
              Evaluation Results
            </p>
            {reEvalError && <Alert tone="error">{reEvalError}</Alert>}
            {questions.map((q, idx) => {
              const result = batchResults[q.id];
              const isReEval = reEvalLoading === q.id;
              const isSkipped = skippedQuestions.has(q.id);
              if (!result) return null;

              return (
                <Card key={q.id} className="overflow-hidden">
                  <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide mb-1">
                        Q{idx + 1} · {q.marks} marks
                      </p>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{q.question}</p>
                    </div>
                    <Badge className={`shrink-0 ${STATUS_BADGES[result.status]}`}>
                      {isSkipped ? 'Skipped' : result.notFound ? 'Not found' : `${result.marks}/${q.marks} · ${Math.round(result.score * 100)}%`}
                    </Badge>
                  </div>

                  <div className="px-5 py-4 space-y-3">
                    {result.notFound && !isSkipped && (
                      <Alert tone="warning" className="text-xs">
                        Answer not found on sheet — check page order or type the answer below, then Re-evaluate.
                      </Alert>
                    )}

                    {!isSkipped && (
                      <div>
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                          Extracted Answer
                          <span className="ml-1.5 font-normal text-zinc-400 dark:text-zinc-500">
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
                          className="w-full border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent resize-y bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-600"
                        />
                        <div className="flex justify-end mt-1.5">
                          <button
                            onClick={() => handleReEvaluate(q.id)}
                            disabled={isReEval || !result.extractedText.trim()}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {isReEval && <Spinner className="w-3 h-3" />}
                            {isReEval ? 'Re-evaluating…' : 'Re-evaluate'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {evalError && <Alert tone="error">{evalError}</Alert>}

        {/* ── Bottom action bar ─────────────────────────────────────────────── */}
        <Card className="px-5 py-4">
          {!allEvaluated ? (
            <Button
              className="w-full py-3"
              onClick={handleEvaluateAll}
              disabled={evaluating || !canEvaluate}
              loading={evaluating}
            >
              {evaluating
                ? 'Reading pages · segmenting answers · grading…'
                : !canEvaluate
                  ? 'Upload pages to evaluate'
                  : `Evaluate (${pages.length} page${pages.length !== 1 ? 's' : ''}${skippedQuestions.size > 0 ? ` · ${skippedQuestions.size} skipped` : ''})`}
            </Button>
          ) : (
            <Button variant="success" className="w-full py-3" icon="circleCheck" onClick={handleGenerateReport}>
              Generate Report
            </Button>
          )}
        </Card>
      </div>
    </>
  );
}
