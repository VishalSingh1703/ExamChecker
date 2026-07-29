import { useEffect, useRef, useState } from 'react';
import { usePractice, usePracticeDispatch } from '../../context/PracticeContext';
import { useCountdown, formatRemaining } from './useCountdown';
import { buildPracticeRecord, finalizeResults, savePracticeRecord, type RawOutcome } from './practiceReport';
import { gradeExtractedText, segmentAndGradeAll, type SheetPage } from '../../services/ai/grading';
import { PageUploader } from '../../components/PageUploader';
import { Alert, Button, Card, Icon, ProgressBar, Spinner, TextArea } from '../../components/ui';

export function TestRunner({ userId, userName, apiKey }: { userId: string; userName: string; apiKey: string }) {
  const state = usePractice();
  const dispatch = usePracticeDispatch();
  const { phase, questions, typedAnswers, answerMode, deadlineAt, durationMin, error } = state;

  const [pages, setPages] = useState<SheetPage[]>([]);
  const [confirmSwitch, setConfirmSwitch] = useState<'typed' | 'photo' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const grading = phase === 'grading';

  // Object URLs must be revoked even after this component unmounts, so the
  // cleanup reads the latest pages through a ref.
  const pagesRef = useRef(pages);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => {
    return () => {
      pagesRef.current.forEach(p => URL.revokeObjectURL(p.url));
      abortRef.current?.abort();
    };
  }, []);

  // Latest submit handler for the timer, avoiding a stale closure
  const submitRef = useRef<() => void>(() => {});

  const remaining = useCountdown(deadlineAt, () => submitRef.current());

  // Warn before an accidental refresh loses the attempt
  useEffect(() => {
    if (phase !== 'testing') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // ── Pages ───────────────────────────────────────────────────────────────────

  function addPages(files: File[]) {
    if (files.length === 0) return;
    setPages(prev => [
      ...prev,
      ...files.map(f => ({ id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f) })),
    ]);
  }

  function removePage(index: number) {
    setPages(prev => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function movePage(index: number, direction: 'up' | 'down') {
    setPages(prev => {
      const next = [...prev];
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  // ── Mode switching ──────────────────────────────────────────────────────────

  const hasTyped = Object.values(typedAnswers).some(t => t.trim());
  const hasPhotos = pages.length > 0;

  function requestMode(mode: 'typed' | 'photo') {
    if (mode === answerMode) return;
    const losingWork = mode === 'photo' ? hasTyped : hasPhotos;
    if (losingWork) { setConfirmSwitch(mode); return; }
    dispatch({ type: 'SET_ANSWER_MODE', payload: mode });
  }

  function confirmModeSwitch() {
    if (!confirmSwitch) return;
    if (confirmSwitch === 'photo') {
      questions.forEach(q => dispatch({ type: 'SET_TYPED_ANSWER', payload: { id: q.id, text: '' } }));
    } else {
      pages.forEach(p => URL.revokeObjectURL(p.url));
      setPages([]);
    }
    dispatch({ type: 'SET_ANSWER_MODE', payload: confirmSwitch });
    setConfirmSwitch(null);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    // Covers both a manual click landing in the same tick as the timer expiring
    // and a re-entrant call from the countdown.
    if (state.phase !== 'testing') return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: 'START_GRADING' });

    try {
      const raw: Record<number, RawOutcome> = {};

      if (answerMode === 'typed') {
        const answered = questions.filter(q => (typedAnswers[q.id] ?? '').trim());
        // Blank answers never reach the API — saves tokens and stops the model
        // inventing credit for an empty string.
        for (const q of questions) {
          if (!(typedAnswers[q.id] ?? '').trim()) raw[q.id] = { extractedText: '', score: 0, skipped: true };
        }
        if (answered.length > 0) {
          const scores = await gradeExtractedText(
            answered.map(q => ({
              id: q.id,
              question: q.question,
              expectedAnswer: q.expectedAnswer,
              keywords: q.keywords ?? [],
              marks: q.marks,
              extractedText: typedAnswers[q.id].trim(),
            })),
            apiKey,
            ctrl.signal,
          );
          for (const q of answered) {
            const s = scores.find(x => x.questionId === q.id);
            raw[q.id] = {
              extractedText: typedAnswers[q.id].trim(),
              score: s?.score ?? 0,
              skipped: !s,
            };
          }
        }
      } else {
        if (pages.length === 0) {
          dispatch({ type: 'FAIL', payload: 'Upload at least one answer sheet page before submitting.' });
          return;
        }
        const graded = await segmentAndGradeAll(
          pages,
          questions.map(q => ({
            id: q.id,
            question: q.question,
            expectedAnswer: q.expectedAnswer,
            keywords: q.keywords ?? [],
            marks: q.marks,
          })),
          apiKey,
          ctrl.signal,
        );
        for (const q of questions) {
          const r = graded.find(x => x.questionId === q.id);
          raw[q.id] = !r || r.notFound
            ? { extractedText: '', score: 0, skipped: true }
            : { extractedText: r.extractedText, score: r.score };
        }
      }

      const results = finalizeResults(questions, raw, state.checkingMode);
      const record = buildPracticeRecord({
        attemptId: state.attemptId || crypto.randomUUID(),
        cls: state.cls,
        subject: state.subject,
        chapter: state.chapter,
        checkingMode: state.checkingMode,
        questions,
        results,
        studentName: state.studentName || userName,
        userId,
      });
      savePracticeRecord(record, userId);
      dispatch({ type: 'GRADING_OK', payload: { results, record } });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      dispatch({ type: 'FAIL', payload: e instanceof Error ? e.message : 'Grading failed — your answers are safe. Tap Submit again.' });
    }
  }

  submitRef.current = handleSubmit;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (grading) {
    return (
      <Card className="animate-fade-in">
        <div className="px-5 py-16 text-center space-y-3">
          <Spinner className="w-8 h-8 mx-auto text-accent-600 dark:text-accent-400" />
          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Marking your answers…</p>
        </div>
      </Card>
    );
  }

  const totalMs = durationMin * 60_000;
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, (remaining / totalMs) * 100)) : 0;
  const low = remaining <= 60_000;
  const mid = !low && remaining <= 5 * 60_000;
  const expired = deadlineAt === null;

  const answeredCount = questions.filter(q => (typedAnswers[q.id] ?? '').trim()).length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Timer ─────────────────────────────────────────────────────────── */}
      <Card className="sticky top-14 z-20 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon
              name="clock"
              className={`w-4 h-4 ${low ? 'text-red-600 dark:text-red-400' : mid ? 'text-amber-600 dark:text-amber-400' : 'text-ink-500 dark:text-ink-400'}`}
            />
            <span
              className={`text-lg font-semibold tabular-nums ${
                low ? 'text-red-600 dark:text-red-400' : mid ? 'text-amber-600 dark:text-amber-400' : 'text-ink-900 dark:text-ink-100'
              }`}
            >
              {expired ? '—' : formatRemaining(remaining)}
            </span>
          </div>
          <span className="text-xs text-ink-400 dark:text-ink-500">
            {answerMode === 'typed'
              ? `${answeredCount}/${questions.length} answered`
              : `${pages.length} page${pages.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        {!expired && <div className="mt-2"><ProgressBar pct={pct} /></div>}
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      {/* ── Answer mode ───────────────────────────────────────────────────── */}
      <Card className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide">
          How are you answering?
        </p>
        <div className="flex rounded-lg overflow-hidden border border-ink-200 dark:border-ink-700 text-xs font-semibold">
          {(['typed', 'photo'] as const).map((m, i) => (
            <button
              key={m}
              onClick={() => requestMode(m)}
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${i === 1 ? 'border-l border-ink-200 dark:border-ink-700' : ''} ${
                answerMode === m
                  ? 'bg-accent-700 text-white'
                  : 'bg-white dark:bg-ink-900 text-ink-500 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800'
              }`}
            >
              <Icon name={m === 'typed' ? 'edit' : 'image'} className="w-3.5 h-3.5" />
              {m === 'typed' ? 'Type' : 'Upload photos'}
            </button>
          ))}
        </div>
      </Card>

      {confirmSwitch && (
        <Alert tone="warning">
          Switching will clear what you've already entered.
          <span className="inline-flex gap-2 ml-2">
            <button onClick={confirmModeSwitch} className="font-semibold underline">Switch anyway</button>
            <button onClick={() => setConfirmSwitch(null)} className="underline">Cancel</button>
          </span>
        </Alert>
      )}

      {/* ── Answers ───────────────────────────────────────────────────────── */}
      {answerMode === 'typed' ? (
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <Card key={q.id} className="overflow-hidden">
              <div className="px-5 pt-4 pb-3 border-b border-ink-100 dark:border-ink-800">
                <p className="text-xs text-ink-400 dark:text-ink-500 font-medium uppercase tracking-wide mb-1">
                  Q{idx + 1} · {q.marks} mark{q.marks !== 1 ? 's' : ''}
                </p>
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">{q.question}</p>
              </div>
              <div className="px-5 py-4">
                <TextArea
                  value={typedAnswers[q.id] ?? ''}
                  onChange={e => dispatch({ type: 'SET_TYPED_ANSWER', payload: { id: q.id, text: e.target.value } })}
                  rows={q.marks <= 2 ? 3 : q.marks <= 5 ? 5 : 8}
                  placeholder="Write your answer…"
                />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <Alert tone="warning">
            Photos are <strong>not</strong> saved if you refresh — finish and submit in this session. Label each
            answer with its question number (Q1, Q2 …) so they can be matched.
          </Alert>
          <Card className="overflow-hidden">
            <PageUploader
              pages={pages}
              onAdd={addPages}
              onRemove={removePage}
              onMove={movePage}
              emptyTitle="Tap to upload your answer sheet"
              emptyHint="Select all pages at once · Reorder below if needed"
            />
          </Card>
        </>
      )}

      {/* ── Submit ────────────────────────────────────────────────────────── */}
      <Card className="px-5 py-4">
        <Button
          variant="success"
          className="w-full py-3"
          icon="circleCheck"
          onClick={handleSubmit}
          disabled={answerMode === 'photo' && pages.length === 0}
        >
          Submit &amp; Mark
        </Button>
      </Card>
    </div>
  );
}
