import { useRef } from 'react';
import { usePractice, usePracticeDispatch } from '../../context/PracticeContext';
import { blueprintTotals, generatePracticePaper, type BlueprintRow } from '../../services/ai/practice';
import {
  PRACTICE_MARK_OPTIONS,
  PRACTICE_MAX_QUESTIONS,
  PRACTICE_MAX_TOTAL_MARKS,
} from '../../config/constants';
import type { Question } from '../../types';
import { Alert, Button, Card, CardHeader, Icon, Select, Spinner } from '../../components/ui';

export function BlueprintEditor({ apiKey }: { apiKey: string }) {
  const state = usePractice();
  const dispatch = usePracticeDispatch();
  const abortRef = useRef<AbortController | null>(null);

  const { blueprint, phase, error, chapterText, sourceName } = state;
  const generating = phase === 'generating';
  const totals = blueprintTotals(blueprint);

  function setRows(rows: BlueprintRow[]) {
    dispatch({ type: 'SET_BLUEPRINT', payload: rows });
  }

  function updateRow(id: string, patch: Partial<BlueprintRow>) {
    setRows(blueprint.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows([...blueprint, { id: crypto.randomUUID(), count: 1, marks: 5 }]);
  }

  function removeRow(id: string) {
    setRows(blueprint.filter(r => r.id !== id));
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  const tooManyQuestions = totals.questions > PRACTICE_MAX_QUESTIONS;
  const tooManyMarks = totals.marks > PRACTICE_MAX_TOTAL_MARKS;
  const empty = totals.questions === 0;
  // Rough capacity check — roughly 800 characters of source per distinct question
  const thin = !empty && totals.questions > Math.floor(chapterText.length / 800);

  const blockedReason =
    empty ? 'Add at least one question'
    : tooManyQuestions ? `Too many questions — the grading step tops out at ${PRACTICE_MAX_QUESTIONS}`
    : tooManyMarks ? `Too many marks — keep the paper under ${PRACTICE_MAX_TOTAL_MARKS}`
    : '';

  async function handleGenerate() {
    if (blockedReason || !apiKey) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: 'START_GENERATE' });
    try {
      const generated = await generatePracticePaper(
        {
          chapterText: state.chapterText,
          blueprint,
          examClass: state.cls,
          subject: state.subject,
          chapter: state.chapter,
        },
        apiKey,
        ctrl.signal,
      );
      // id = index + 1 keeps these byte-compatible with the grading and report engine
      const questions: Question[] = generated.map((g, i) => ({
        id: i + 1,
        question: g.question,
        expectedAnswer: g.expectedAnswer,
        marks: g.marks,
        keywords: g.keywords,
      }));
      dispatch({ type: 'GENERATE_OK', payload: questions });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      dispatch({ type: 'FAIL', payload: e instanceof Error ? e.message : 'Could not generate the paper.' });
    }
  }

  if (generating) {
    return (
      <Card className="animate-fade-in">
        <div className="px-5 py-16 text-center space-y-3">
          <Spinner className="w-8 h-8 mx-auto text-accent-600 dark:text-accent-400" />
          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
            Writing {totals.questions} question{totals.questions !== 1 ? 's' : ''} and model answers…
          </p>
          <p className="text-xs text-ink-400 dark:text-ink-500">Using the chapter text already read — no re-upload.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardHeader
          title="Questions &amp; marks"
          subtitle={`Build the paper from ${sourceName || 'the chapter'}.`}
          action={
            <button
              onClick={() => dispatch({ type: 'RESET' })}
              className="text-xs text-ink-500 dark:text-ink-400 hover:text-accent-700 dark:hover:text-accent-400 hover:underline"
            >
              Change chapter
            </button>
          }
        />

        <div className="px-5 pb-2 space-y-2">
          {blueprint.map(row => (
            <div key={row.id} className="flex items-center gap-2 flex-wrap">
              <div className="w-[4.5rem] shrink-0">
                <Select
                  value={String(row.count)}
                  onChange={e => updateRow(row.id, { count: Number(e.target.value) })}
                  aria-label="Number of questions"
                >
                  {Array.from({ length: PRACTICE_MAX_QUESTIONS }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </div>
              <span className="text-sm text-ink-500 dark:text-ink-400">question{row.count !== 1 ? 's' : ''} ×</span>
              <div className="w-[4.5rem] shrink-0">
                <Select
                  value={String(row.marks)}
                  onChange={e => updateRow(row.id, { marks: Number(e.target.value) })}
                  aria-label="Marks per question"
                >
                  {PRACTICE_MARK_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <span className="text-sm text-ink-500 dark:text-ink-400">marks</span>
              <span className="text-sm font-semibold text-ink-800 dark:text-ink-100 ml-auto tabular-nums">
                = {row.count * row.marks}
              </span>
              <button
                onClick={() => removeRow(row.id)}
                disabled={blueprint.length === 1}
                aria-label="Remove row"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 transition-colors"
              >
                <Icon name="x" className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="px-5 pb-4">
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-ink-300 dark:border-ink-600 rounded-lg text-sm text-ink-500 dark:text-ink-400 hover:border-accent-400 dark:hover:border-accent-500 hover:text-accent-700 dark:hover:text-accent-400 transition-colors"
          >
            <Icon name="plus" className="w-4 h-4" />
            Add row
          </button>
        </div>

        <div className="px-5 py-3 border-t border-ink-100 dark:border-ink-800 flex items-center justify-between text-sm">
          <span className="text-ink-500 dark:text-ink-400">Total</span>
          <span className="font-semibold text-ink-900 dark:text-ink-100 tabular-nums">
            {totals.questions} question{totals.questions !== 1 ? 's' : ''} · {totals.marks} marks
          </span>
        </div>
      </Card>

      {thin && !blockedReason && (
        <Alert tone="warning">
          This chapter may be too short for {totals.questions} distinct questions — expect some overlap.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <Card className="px-5 py-4">
        <Button
          className="w-full py-3"
          icon="sparkles"
          onClick={handleGenerate}
          disabled={!!blockedReason}
        >
          {blockedReason || `Generate ${totals.questions} Question${totals.questions !== 1 ? 's' : ''}`}
        </Button>
      </Card>
    </div>
  );
}
