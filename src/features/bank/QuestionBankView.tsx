import { useState, useRef } from 'react';
import { saveChapter, type BankQuestion } from '../../services/data/questionBank';
import { useExam } from '../../context/ExamContext';
import type { SubPart } from '../../types';
import { resolveGeminiKey } from '../../config/env';
import { CLASS_OPTIONS, MAX_QUESTION_MARKS } from '../../config/constants';
import { extractQuestionsFromFile, generateModelAnswer, refineAnswer, type ExtractedQuestion } from '../../services/ai/authoring';
import { Alert, Button, Card, Icon, Select, Spinner, TextInput } from '../../components/ui';
import { QuestionEditorCard, GenerateAllButton, type EditableQuestion, type AiBusy } from '../setup/QuestionEditorCard';

interface EditableQ extends EditableQuestion {
  id: string;
}

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
      done ? 'bg-purple-700 border-purple-700 text-white'
        : active ? 'border-purple-700 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
        : 'border-zinc-300 dark:border-zinc-600 text-zinc-400'
    }`}>
      {done ? <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} /> : n}
    </div>
  );
}

export function QuestionBankView({ userId = '', onBack }: { userId?: string; onBack: () => void }) {
  const { geminiApiKey } = useExam();
  const apiKey = resolveGeminiKey(geminiApiKey);

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1
  const [cls, setCls] = useState('');
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');

  // Step 2
  const [questions, setQuestions] = useState<EditableQ[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [aiBusy, setAiBusy] = useState<{ id: string; mode: NonNullable<AiBusy> } | null>(null);
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  const anyBusy = aiBusy !== null || generatingAll;

  function addManual() {
    setQuestions(prev => [...prev, { id: crypto.randomUUID(), question: '', expectedAnswer: '', marks: 5, subparts: [] }]);
  }

  function updateQ(id: string, patch: Partial<EditableQuestion>) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
  }

  function clearGenError(id: string) {
    setGenErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Default the chapter name to the first file's name
    if (!chapter.trim() && files[0]) {
      setChapter(files[0].name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim());
    }
    setExtracting(true);
    setExtractError('');
    try {
      const extracted: ExtractedQuestion[] = [];
      for (const file of Array.from(files)) {
        extracted.push(...await extractQuestionsFromFile(file, apiKey));
      }
      setQuestions(prev => [
        ...prev,
        ...extracted.map(eq => ({
          id: crypto.randomUUID(),
          question: eq.question,
          expectedAnswer: '',
          marks: 5,
          subparts: eq.subparts.map((text, i) => ({
            id: crypto.randomUUID(),
            label: String.fromCharCode(97 + i),
            question: text,
          })) as SubPart[],
        })),
      ]);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract questions.');
    } finally {
      setExtracting(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  }

  async function handleGenerate(id: string) {
    const q = questions.find(x => x.id === id);
    if (!q?.question.trim()) return;
    setAiBusy({ id, mode: 'generate' });
    clearGenError(id);
    try {
      const answer = await generateModelAnswer(q.question, cls, q.marks, apiKey);
      updateQ(id, { expectedAnswer: answer });
    } catch (err) {
      setGenErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed.' }));
    } finally {
      setAiBusy(null);
    }
  }

  async function handleRefine(id: string, mode: 'shorten' | 'define') {
    const q = questions.find(x => x.id === id);
    if (!q?.expectedAnswer.trim()) return;
    setAiBusy({ id, mode });
    clearGenError(id);
    try {
      const answer = await refineAnswer(q.question, q.expectedAnswer, cls, q.marks, mode, apiKey);
      updateQ(id, { expectedAnswer: answer });
    } catch (err) {
      setGenErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed.' }));
    } finally {
      setAiBusy(null);
    }
  }

  async function generateAllAnswers() {
    const toGenerate = questions.filter(q => q.question.trim() && !q.expectedAnswer.trim());
    if (toGenerate.length === 0) return;
    setGeneratingAll(true);
    for (const q of toGenerate) {
      await handleGenerate(q.id);
    }
    setGeneratingAll(false);
  }

  async function handleSave() {
    if (questions.length === 0) return;
    setSaving(true);
    const bankQs: BankQuestion[] = questions.map(q => ({
      id: q.id,
      question: q.question.trim(),
      expectedAnswer: q.expectedAnswer.trim(),
      marks: Number(q.marks),
      subparts: q.subparts?.length ? q.subparts : undefined,
      diagram: q.diagram,
    }));
    await saveChapter({
      id: crypto.randomUUID(),
      userId,
      class: cls,
      subject,
      chapter,
      questions: bankQs,
      createdAt: new Date().toISOString(),
    }, userId);
    setSavedMsg(`"${chapter}" saved with ${bankQs.length} question${bankQs.length !== 1 ? 's' : ''}.`);
    setSaving(false);
  }

  const missingAnswers = questions.filter(q => q.question.trim() && !q.expectedAnswer.trim()).length;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} aria-label="Back" className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors">
          <Icon name="chevronLeft" className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">Question Bank</h1>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Upload questions from textbooks or enter them manually.</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        <StepDot n={1} active={step === 1} done={step > 1} />
        <div className={`flex-1 h-0.5 rounded-full ${step > 1 ? 'bg-purple-700' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
        <StepDot n={2} active={step === 2} done={false} />
      </div>

      {/* ── Step 1: Info ─────────────────────────────────────────────────────── */}
      {step === 1 && (
        <Card className="p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Upload Questions</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Select the class and subject. You can name the chapter on the next step.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">Class</label>
            <Select value={cls} onChange={e => setCls(e.target.value)}>
              <option value="">Select a class…</option>
              {CLASS_OPTIONS.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">Subject</label>
            <TextInput
              type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Biology, Mathematics, History"
            />
          </div>

          <Button className="w-full py-3" onClick={() => setStep(2)} disabled={!cls || !subject.trim()}>
            Continue →
          </Button>
        </Card>
      )}

      {/* ── Step 2: Questions ────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Context badges */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-xs font-medium">{cls}</span>
            <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium">{subject}</span>
            {chapter && <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium">{chapter}</span>}
          </div>

          {/* Chapter name */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">Chapter Name</label>
            <TextInput
              type="text" value={chapter} onChange={e => setChapter(e.target.value)}
              placeholder="e.g. Chapter 3 — Photosynthesis"
            />
          </Card>

          {/* Upload strip */}
          <Card className="p-4">
            <input ref={photoRef} type="file" accept="image/*,.pdf,.txt" multiple className="hidden"
              onChange={e => handleFileUpload(e.target.files)} />
            <div className="flex items-center gap-3 flex-wrap">
              <Button icon={extracting ? undefined : 'upload'} loading={extracting} onClick={() => photoRef.current?.click()}>
                {extracting ? 'Extracting…' : 'Upload Questions'}
              </Button>
              <div className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
                AI will extract all questions automatically
                <span className="block text-zinc-300 dark:text-zinc-600">Photo · PDF · .txt file</span>
              </div>
            </div>
            {extractError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{extractError}</p>}
          </Card>

          {questions.length > 0 && (
            <GenerateAllButton missing={missingAnswers} busy={generatingAll} disabled={anyBusy} onClick={generateAllAnswers} />
          )}

          {/* Question list */}
          {questions.length > 0 && (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <QuestionEditorCard
                  key={q.id}
                  index={idx}
                  value={q}
                  busy={aiBusy?.id === q.id ? aiBusy.mode : null}
                  anyBusy={anyBusy}
                  error={genErrors[q.id]}
                  onChange={patch => updateQ(q.id, patch)}
                  onRemove={() => setQuestions(prev => prev.filter(x => x.id !== q.id))}
                  onGenerate={() => handleGenerate(q.id)}
                  onRefine={mode => handleRefine(q.id, mode)}
                />
              ))}
            </div>
          )}

          {questions.length > 2 && (
            <GenerateAllButton missing={missingAnswers} busy={generatingAll} disabled={anyBusy} onClick={generateAllAnswers} />
          )}

          <button onClick={addManual}
            className="w-full py-3 border-2 border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 rounded-2xl text-sm font-medium hover:border-purple-400 hover:text-purple-700 dark:hover:border-purple-600 dark:hover:text-purple-400 transition-colors flex items-center justify-center gap-2">
            <Icon name="plus" className="w-4 h-4" />
            Add Question Manually
          </button>

          {/* Save / saved */}
          {savedMsg ? (
            <Alert tone="success">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{savedMsg}</p>
                  <p className="text-xs mt-0.5 opacity-80">You can now import these in the Setup tab.</p>
                </div>
                <button onClick={onBack} className="text-sm font-medium hover:underline shrink-0">Go to Setup</button>
              </div>
            </Alert>
          ) : (
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(1)}>← Back</Button>
              <Button
                className="flex-1 py-3"
                onClick={handleSave}
                disabled={saving || questions.length === 0 || !chapter.trim() || questions.some(q => q.marks === 0 || q.marks > MAX_QUESTION_MARKS)}
              >
                {saving ? <Spinner className="w-4 h-4" /> : null}
                {saving ? 'Saving…' : `Save ${questions.length} Question${questions.length !== 1 ? 's' : ''} to Bank`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
