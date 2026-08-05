import { useRef, useState } from 'react';
import { usePractice, usePracticeDispatch } from '../../context/PracticeContext';
import { generatePracticePaper } from '../../services/ai/practice';
import { saveChapter, type BankQuestion } from '../../services/data/questionBank';
import {
  MODE_HINTS,
  MODE_LABELS,
  PRACTICE_DURATION_PRESETS,
  PRACTICE_MODES,
} from '../../config/constants';
import type { CheckingMode, Question } from '../../types';
import { Alert, Button, Card, CardHeader, FieldLabel, Select, TextInput } from '../../components/ui';

export function PaperPreview({ userId, apiKey }: { userId: string; apiKey: string }) {
  const state = usePractice();
  const dispatch = usePracticeDispatch();
  const abortRef = useRef<AbortController | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  const { questions, checkingMode, durationMin, studentName, error } = state;
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

  async function handleRegenerate() {
    if (!apiKey) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRegenerating(true);
    dispatch({ type: 'CLEAR_ERROR' });
    try {
      // Uses the cached chapter text — no second extraction call
      const generated = await generatePracticePaper(
        {
          chapterText: state.chapterText,
          blueprint: state.blueprint,
          examClass: state.cls,
          subject: state.subject,
          chapter: state.chapter,
        },
        apiKey,
        ctrl.signal,
      );
      const next: Question[] = generated.map((g, i) => ({
        id: i + 1,
        question: g.question,
        expectedAnswer: g.expectedAnswer,
        marks: g.marks,
        keywords: g.keywords,
      }));
      dispatch({ type: 'GENERATE_OK', payload: next });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        dispatch({ type: 'FAIL', payload: e instanceof Error ? e.message : 'Could not regenerate.' });
      }
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSaveToBank() {
    setSaving(true);
    setSaveError('');
    setSavedMsg('');
    try {
      // The one place a numeric Question.id crosses into the bank's string ids
      const bankQuestions: BankQuestion[] = questions.map(q => ({
        id: crypto.randomUUID(),
        question: q.question,
        expectedAnswer: q.expectedAnswer,
        marks: q.marks,
        keywords: q.keywords,
      }));
      await saveChapter(
        {
          id: crypto.randomUUID(),
          userId,
          class: state.cls,
          subject: state.subject,
          chapter: state.chapter,
          questions: bankQuestions,
          createdAt: new Date().toISOString(),
        },
        userId,
      );
      setSavedMsg(`Saved to Question Bank under ${state.subject} › ${state.chapter}.`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save to the Question Bank.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardHeader
          title={`${questions.length} question${questions.length !== 1 ? 's' : ''} · ${totalMarks} marks`}
          subtitle={`${state.subject} — ${state.chapter}`}
          action={
            <button
              onClick={() => dispatch({ type: 'GO_BLUEPRINT' })}
              className="text-xs text-ink-500 dark:text-ink-400 hover:text-accent-700 dark:hover:text-accent-400 hover:underline"
            >
              Change blueprint
            </button>
          }
        />
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <Alert tone="info">
        Model answers are hidden so the test is a fair one. You&rsquo;ll see them beside your own answers in
        the report once you submit.
      </Alert>

      <div className="space-y-3">
        {questions.map((q, idx) => (
          <Card key={q.id} className="px-5 py-4">
            <p className="text-xs text-ink-400 dark:text-ink-500 font-medium uppercase tracking-wide mb-1">
              Q{idx + 1} · {q.marks} mark{q.marks !== 1 ? 's' : ''}
            </p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">{q.question}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Test settings" />
        <div className="px-5 pb-5 space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>Your name</FieldLabel>
              <TextInput
                value={studentName}
                onChange={e => dispatch({ type: 'SET_META', payload: { studentName: e.target.value } })}
                placeholder="Shown on the report"
              />
            </div>
            <div>
              <FieldLabel>Duration</FieldLabel>
              <Select
                value={String(durationMin)}
                onChange={e => dispatch({ type: 'SET_DURATION', payload: Number(e.target.value) })}
              >
                {PRACTICE_DURATION_PRESETS.map(m => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>Grading</FieldLabel>
              <Select
                value={checkingMode}
                onChange={e => dispatch({ type: 'SET_MODE', payload: e.target.value as CheckingMode })}
              >
                {PRACTICE_MODES.map(m => (
                  <option key={m} value={m}>{MODE_LABELS[m].label}</option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-ink-500 dark:text-ink-400">{MODE_HINTS[checkingMode]}</p>
        </div>
      </Card>

      {savedMsg && <Alert tone="success">{savedMsg}</Alert>}
      {saveError && <Alert tone="error">{saveError}</Alert>}

      <Card className="px-5 py-4 space-y-2">
        <Button variant="success" className="w-full py-3" icon="clock" onClick={() => dispatch({ type: 'START_TEST' })}>
          Start Test · {durationMin} min
        </Button>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            icon="bank"
            onClick={handleSaveToBank}
            loading={saving}
            disabled={saving || regenerating}
          >
            Save to Question Bank
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            icon="refresh"
            onClick={handleRegenerate}
            loading={regenerating}
            disabled={saving || regenerating}
          >
            Regenerate
          </Button>
        </div>
      </Card>
    </div>
  );
}
