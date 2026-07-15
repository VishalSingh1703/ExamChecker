import { useState, useEffect } from 'react';
import type { AnswerKey, CheckingMode, SavedSubject, SubPart } from '../../types';
import { useExam, useExamDispatch } from '../../context/ExamContext';
import { loadChapters, type BankChapter } from '../../services/data/questionBank';
import { readJson, writeJson, storageKeys } from '../../services/storage';
import { resolveGeminiKey } from '../../config/env';
import { CLASS_OPTIONS, CHECKING_MODES, MAX_QUESTION_MARKS } from '../../config/constants';
import { generateModelAnswer, refineAnswer } from '../../services/ai/authoring';
import { Button, Card, Icon, TextInput, Select, Spinner } from '../../components/ui';
import { QuestionEditorCard, GenerateAllButton, type EditableQuestion, type AiBusy } from './QuestionEditorCard';

// ── Local storage helpers ─────────────────────────────────────────────────────

interface Suggestions { terms: string[]; sections: string[] }

function loadSubjects(userId: string): SavedSubject[] {
  return readJson<SavedSubject[]>(storageKeys.subjects(userId), []);
}

function loadSuggestions(userId: string): Suggestions {
  return readJson<Suggestions>(storageKeys.suggestions(userId), { terms: [], sections: [] });
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].slice(0, 10);
}

// ── Keywords helpers ──────────────────────────────────────────────────────────

function parseKeywords(raw: string): string[] {
  return raw.split(/[,\n]/).map(k => k.trim().toLowerCase()).filter(Boolean);
}

function invalidKeywords(raw: string, expectedAnswer: string): string[] {
  if (!raw.trim()) return [];
  const answer = expectedAnswer.toLowerCase();
  return parseKeywords(raw).filter(k => !answer.includes(k));
}

// ── Small local components ────────────────────────────────────────────────────

function SuggestInput({ label, value, onChange, placeholder, suggestions }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value);
  return (
    <div className="relative">
      <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">{label}</label>
      <TextInput
        type="text" value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 rounded-xl shadow-lg overflow-hidden">
          {filtered.map(s => (
            <button key={s} onMouseDown={() => { onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-ink-700 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-ink-700">{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [{ n: 1, label: 'Exam Context' }, { n: 2, label: 'Subject' }, { n: 3, label: 'Student' }];
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
              step > s.n ? 'bg-accent-700 border-accent-700 text-white'
                : step === s.n ? 'border-accent-700 text-accent-700 dark:text-accent-400 bg-accent-50 dark:bg-accent-900/20'
                : 'border-ink-300 dark:border-ink-600 text-ink-400 dark:text-ink-500'}`}>
              {step > s.n ? <Icon name="check" className="w-4 h-4" strokeWidth={3} /> : s.n}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step === s.n ? 'text-accent-700 dark:text-accent-400' : 'text-ink-400 dark:text-ink-500'}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-12 sm:w-20 mx-1 mb-4 rounded-full transition-colors ${step > s.n ? 'bg-accent-700' : 'bg-ink-200 dark:bg-ink-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CheckingModeSelector({ value, onChange }: { value: CheckingMode; onChange: (m: CheckingMode) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-wider mb-2">Checking Mode</p>
      <div className="flex gap-2">
        {CHECKING_MODES.map(m => (
          <button key={m} onClick={() => onChange(m)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors capitalize ${
              value === m ? 'bg-accent-700 text-white shadow-sm shadow-accent-700/20' : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-400 hover:bg-ink-200 dark:hover:bg-ink-700'
            }`}>
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

function BlockedHint({ reason }: { reason: string }) {
  if (!reason) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-xl shadow-sm text-xs font-medium max-w-xs print:hidden">
      <Icon name="warning" className="w-3.5 h-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
      {reason}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ExamSetup({ userId = '' }: { userId?: string }) {
  const { geminiApiKey, hfApiKey, checkingMode } = useExam();
  const dispatch = useExamDispatch();
  const apiKey = resolveGeminiKey(geminiApiKey);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [examTerm, setExamTerm] = useState('');
  const [examClass, setExamClass] = useState('');

  // Step 2 — subject selection
  const [subjects, setSubjects] = useState<SavedSubject[]>(() => loadSubjects(userId));
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const classSubjects = subjects.filter(s => s.examClass === examClass);
  const [subjectMode, setSubjectMode] = useState<'select' | 'create'>('select');

  // Step 2 — subject creation / editing
  const [newName, setNewName] = useState('');
  const [newQuestions, setNewQuestions] = useState<EditableQuestion[]>([]);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  // Step 3
  const [studentName, setStudentName] = useState('');
  const [studentSection, setStudentSection] = useState('');
  const [studentId, setStudentId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // AI busy state
  const [aiBusy, setAiBusy] = useState<{ idx: number; mode: NonNullable<AiBusy> } | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const anyBusy = aiBusy !== null || generatingAll;

  // Question bank import state
  const [bankChapters, setBankChapters] = useState<BankChapter[]>([]);
  const [showBankPanel, setShowBankPanel] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [randomN, setRandomN] = useState(5);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  const [chapterSearch, setChapterSearch] = useState('');

  const [suggestions] = useState<Suggestions>(() => loadSuggestions(userId));

  useEffect(() => {
    if (subjectMode !== 'create' || !examClass) return;
    loadChapters(userId, examClass, newName.trim() || undefined).then(setBankChapters);
  }, [subjectMode, examClass, newName, userId]);

  const selectedSubject = subjects.find(s => s.id === selectedSubjectId) ?? null;
  const answerKey: AnswerKey | null = selectedSubject
    ? {
        exam: {
          title: selectedSubject.name,
          subject: selectedSubject.name,
          totalMarks: selectedSubject.questions.reduce((s, q) => s + q.marks, 0),
        },
        questions: selectedSubject.questions.map(q => ({ ...q, keywords: q.keywords ?? [] })),
      }
    : null;

  // ── Subject CRUD ────────────────────────────────────────────────────────────

  function persistSubjects(updated: SavedSubject[]) {
    setSubjects(updated);
    writeJson(storageKeys.subjects(userId), updated);
  }

  function bankToEditable(q: { question: string; expectedAnswer: string; marks: number; keywords?: string[]; subparts?: SubPart[]; diagram?: string }): EditableQuestion {
    return {
      question: q.question,
      expectedAnswer: q.expectedAnswer,
      marks: q.marks,
      keywords: (q.keywords ?? []).join(', '),
      subparts: q.subparts ?? [],
      diagram: q.diagram,
    };
  }

  function addQuestion() {
    setNewQuestions(prev => [...prev, { question: '', expectedAnswer: '', marks: 5, keywords: '', subparts: [] }]);
  }

  function updateQuestion(idx: number, patch: Partial<EditableQuestion>) {
    setNewQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }

  function removeQuestion(idx: number) {
    setNewQuestions(prev => prev.filter((_, i) => i !== idx));
  }

  function saveNewSubject() {
    if (!newName.trim() || newQuestions.length === 0) return;
    const questions = newQuestions.map((q, i) => ({
      id: i + 1,
      question: q.question,
      expectedAnswer: q.expectedAnswer,
      marks: Number(q.marks) || 5,
      keywords: parseKeywords(q.keywords ?? ''),
      subparts: q.subparts?.length ? q.subparts : undefined,
      diagram: q.diagram,
    }));
    let updated: SavedSubject[];
    let selectId: string;
    if (editingSubjectId) {
      updated = subjects.map(s =>
        s.id === editingSubjectId ? { ...s, name: newName.trim(), questions } : s
      );
      selectId = editingSubjectId;
    } else {
      const subject: SavedSubject = { id: crypto.randomUUID(), name: newName.trim(), examClass, questions };
      updated = [...subjects, subject];
      selectId = subject.id;
    }
    persistSubjects(updated);
    setSelectedSubjectId(selectId);
    cancelCreate();
  }

  function startEdit(s: SavedSubject) {
    setNewName(s.name);
    setNewQuestions(s.questions.map(bankToEditable));
    setEditingSubjectId(s.id);
    setSubjectMode('create');
  }

  function cancelCreate() {
    setSubjectMode('select');
    setNewName('');
    setNewQuestions([]);
    setShowBankPanel(false);
    setEditingSubjectId(null);
  }

  function deleteSubject(id: string) {
    persistSubjects(subjects.filter(s => s.id !== id));
    if (selectedSubjectId === id) setSelectedSubjectId(null);
  }

  // ── Question Bank import ────────────────────────────────────────────────────

  function toggleChapter(id: string) {
    setSelectedChapterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectedBankQuestions() {
    return bankChapters.filter(c => selectedChapterIds.has(c.id)).flatMap(c => c.questions);
  }

  function importFromBank() {
    setNewQuestions(prev => [...prev, ...selectedBankQuestions().map(bankToEditable)]);
    setShowBankPanel(false);
  }

  function randomizeFromBank() {
    const shuffled = [...selectedBankQuestions()].sort(() => Math.random() - 0.5).slice(0, randomN);
    setNewQuestions(shuffled.map(bankToEditable));
    setShowBankPanel(false);
  }

  function shuffleQuestion(idx: number) {
    setShuffleError(null);
    const currentQ = newQuestions[idx];
    const allBankQs = bankChapters.flatMap(c => c.questions);
    const inUse = new Set(newQuestions.map(q => q.question));
    const candidates = allBankQs.filter(bq => bq.marks === currentQ.marks && !inUse.has(bq.question));
    if (candidates.length === 0) {
      setShuffleError(`No other bank question with ${currentQ.marks} mark${currentQ.marks !== 1 ? 's' : ''} found.`);
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    setNewQuestions(prev => prev.map((q, i) => i === idx ? bankToEditable(pick) : q));
  }

  // ── AI actions ──────────────────────────────────────────────────────────────

  async function generateAnswer(idx: number) {
    const q = newQuestions[idx];
    if (!q.question.trim()) return;
    setAiBusy({ idx, mode: 'generate' });
    setGenerateError(null);
    try {
      const text = await generateModelAnswer(q.question, examClass, q.marks, apiKey);
      updateQuestion(idx, { expectedAnswer: text });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setAiBusy(null);
    }
  }

  async function processAnswer(idx: number, mode: 'shorten' | 'define') {
    const q = newQuestions[idx];
    if (!q.expectedAnswer.trim()) return;
    setAiBusy({ idx, mode });
    setGenerateError(null);
    try {
      const text = await refineAnswer(q.question, q.expectedAnswer, examClass, q.marks, mode, apiKey);
      updateQuestion(idx, { expectedAnswer: text });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setAiBusy(null);
    }
  }

  async function generateAllAnswers() {
    const indices = newQuestions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.question.trim() && !q.expectedAnswer.trim())
      .map(({ i }) => i);
    if (indices.length === 0) return;
    setGeneratingAll(true);
    for (const idx of indices) {
      await generateAnswer(idx);
    }
    setGeneratingAll(false);
  }

  // ── Start grading ───────────────────────────────────────────────────────────

  function handleStart() {
    if (!answerKey || !studentName.trim() || !studentSection.trim() || !studentId.trim()) return;
    const s = loadSuggestions(userId);
    writeJson(storageKeys.suggestions(userId), {
      terms: dedupe([examTerm, ...(s.terms ?? [])]),
      sections: dedupe([studentSection, ...(s.sections ?? [])]),
    });
    dispatch({ type: 'SET_EXAM_META', payload: { examTerm, examClass } });
    const resolvedStudentId =
      `${studentName}-${studentId}-${examClass}-${studentSection}`.replace(/\s+/g, '').toLowerCase();
    dispatch({ type: 'SET_STUDENT_INFO', payload: { studentName, studentSection, studentId: resolvedStudentId } });
    dispatch({ type: 'SET_ANSWER_KEY', payload: answerKey });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'grade' });
  }

  // ── Blocked-reason strings ──────────────────────────────────────────────────

  function step1BlockedReason(): string {
    if (!examTerm.trim()) return 'Enter an exam term to continue.';
    if (!examClass) return 'Select a class to continue.';
    return '';
  }

  function step2SelectBlockedReason(): string {
    if (!selectedSubjectId) return 'Select a subject to continue.';
    return '';
  }

  function step2CreateBlockedReason(): string {
    if (!newName.trim()) return 'Enter a subject name.';
    if (newQuestions.length === 0) return 'Add at least one question.';
    if (newQuestions.some(q => !q.question.trim())) return 'Fill in the question text for all questions.';
    if (newQuestions.some(q => !q.expectedAnswer.trim())) return 'All questions need an expected answer — type one or click "Generate".';
    if (newQuestions.some(q => q.marks === 0)) return 'Enter marks for all questions.';
    if (newQuestions.some(q => q.marks > MAX_QUESTION_MARKS)) return `Marks cannot exceed ${MAX_QUESTION_MARKS} for any question.`;
    if (newQuestions.some(q => invalidKeywords(q.keywords ?? '', q.expectedAnswer).length > 0))
      return 'Some keywords are not found in their expected answer — fix or remove them.';
    return '';
  }

  function step3BlockedReason(): string {
    if (!studentName.trim()) return "Enter the student's name.";
    if (!studentId.trim()) return 'Enter the student ID.';
    if (!studentSection.trim()) return "Enter the student's section.";
    return '';
  }

  const missingAnswers = newQuestions.filter(q => q.question.trim() && !q.expectedAnswer.trim()).length;
  const filteredChapters = bankChapters.filter(c => !chapterSearch.trim() || c.chapter.toLowerCase().includes(chapterSearch.toLowerCase()));

  // ══ RENDER ══════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-2xl mx-auto">
      <StepIndicator step={step} />

      {/* ── Step 1: Exam Context ─────────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <div className="animate-fade-in space-y-6">
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100 tracking-tight">Exam Context</h2>
                <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">Define the exam term and class before selecting the answer key.</p>
              </div>

              <SuggestInput label="Exam Term" value={examTerm} onChange={setExamTerm}
                placeholder="e.g. Term 1, Mid-Term, Final Exam" suggestions={suggestions.terms ?? []} />

              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">Class</label>
                <Select value={examClass} onChange={e => setExamClass(e.target.value)}>
                  <option value="">Select a class…</option>
                  {CLASS_OPTIONS.map(group => (
                    <optgroup key={group.group} label={group.group}>
                      {group.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </div>
            </Card>

            <Button className="w-full py-3" onClick={() => setStep(2)} disabled={!!step1BlockedReason()}>
              Continue →
            </Button>
          </div>
          <BlockedHint reason={step1BlockedReason()} />
        </>
      )}

      {/* ── Step 2: Subject selection ────────────────────────────────────────── */}
      {step === 2 && subjectMode === 'select' && (
        <>
          <div className="animate-fade-in space-y-6">
            <Card className="p-6 space-y-5">
              <div className="flex items-center gap-3">
                <Icon name="book" className="w-6 h-6 text-accent-700 dark:text-accent-400" />
                <div>
                  <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100 tracking-tight">Select Subject</h2>
                  <p className="text-xs text-ink-400 dark:text-ink-500">Choose a subject with a pre-configured answer key.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {classSubjects.map(s => {
                  const selected = selectedSubjectId === s.id;
                  const total = s.questions.reduce((acc, q) => acc + q.marks, 0);
                  return (
                    <div
                      key={s.id}
                      className={`rounded-2xl border-2 transition-colors overflow-hidden ${
                        selected
                          ? 'border-accent-600 bg-accent-50 dark:bg-accent-900/20'
                          : 'border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-800'
                      }`}
                    >
                      <button onClick={() => setSelectedSubjectId(s.id)} className="w-full text-left p-4">
                        <div className="flex items-start justify-between">
                          <p className="font-semibold text-ink-900 dark:text-ink-100 text-sm">{s.name}</p>
                          {selected && <Icon name="check" className="w-4 h-4 text-accent-700 dark:text-accent-400 shrink-0 mt-0.5" strokeWidth={2.5} />}
                        </div>
                        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{s.questions.length} Question{s.questions.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-ink-500 dark:text-ink-400">{total} Total Marks</p>
                      </button>
                      <div className={`flex divide-x text-xs border-t ${selected ? 'border-accent-200 dark:border-accent-800 divide-accent-200 dark:divide-accent-800' : 'border-ink-100 dark:border-ink-700 divide-ink-100 dark:divide-ink-700'}`}>
                        <button
                          onClick={() => startEdit(s)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-ink-500 dark:text-ink-400 hover:text-accent-700 dark:hover:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                        >
                          <Icon name="edit" className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => deleteSubject(s.id)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-ink-500 dark:text-ink-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Icon name="trash" className="w-3 h-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={() => { setSubjectMode('create'); addQuestion(); }}
                  className="text-left rounded-2xl p-4 border-2 border-dashed border-ink-300 dark:border-ink-600 hover:border-accent-400 dark:hover:border-accent-600 flex flex-col items-center justify-center gap-1 bg-transparent transition-colors min-h-[90px]"
                >
                  <Icon name="plus" className="w-6 h-6 text-ink-400 dark:text-ink-500" />
                  <span className="text-sm text-ink-500 dark:text-ink-400">New Subject</span>
                </button>
              </div>

              {selectedSubjectId && (
                <>
                  <div className="border-t border-ink-100 dark:border-ink-800" />
                  <CheckingModeSelector value={checkingMode} onChange={m => dispatch({ type: 'SET_CHECKING_MODE', payload: m })} />
                </>
              )}
            </Card>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setStep(1); setSelectedSubjectId(null); }}>
                ← Back
              </Button>
              <Button className="flex-1 py-3" onClick={() => setStep(3)} disabled={!!step2SelectBlockedReason()}>
                Continue →
              </Button>
            </div>
          </div>
          <BlockedHint reason={step2SelectBlockedReason()} />
        </>
      )}

      {/* ── Step 2: Create / edit subject ────────────────────────────────────── */}
      {step === 2 && subjectMode === 'create' && (
        <>
          <div className="animate-fade-in space-y-4">
            <Card className="p-6 space-y-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100 tracking-tight">{editingSubjectId ? 'Edit Subject' : 'Create New Subject'}</h2>
                <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">{editingSubjectId ? 'Update questions and expected answers for this subject.' : 'Add questions and expected answers. This subject will be saved for future use.'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">Subject Name</label>
                <TextInput
                  type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  autoFocus placeholder="e.g. Biology, Mathematics"
                />
              </div>

              {/* Import from Question Bank */}
              {bankChapters.length > 0 && (
                <div className="border border-dashed border-accent-300 dark:border-accent-700 rounded-xl overflow-hidden">
                  <button
                    onClick={() => { setShowBankPanel(p => !p); setChapterSearch(''); }}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-accent-700 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Icon name="bank" className="w-4 h-4" />
                      Import from Question Bank
                      <span className="text-xs text-accent-600 dark:text-accent-500 font-normal">({bankChapters.length} chapter{bankChapters.length !== 1 ? 's' : ''}{newName.trim() ? ` · ${newName.trim()}` : ''})</span>
                    </span>
                    <Icon name="chevronDown" className={`w-4 h-4 transition-transform ${showBankPanel ? 'rotate-180' : ''}`} />
                  </button>

                  {showBankPanel && (
                    <div className="px-4 pb-4 space-y-3 border-t border-accent-100 dark:border-accent-800 bg-accent-50/40 dark:bg-accent-900/10">
                      <div className="relative pt-3">
                        <Icon name="search" className="absolute left-3 top-1/2 mt-1.5 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                        <input
                          type="text"
                          value={chapterSearch}
                          onChange={e => setChapterSearch(e.target.value)}
                          placeholder="Search chapters…"
                          className="w-full pl-8 pr-3 py-1.5 text-sm border border-ink-200 dark:border-ink-700 rounded-lg bg-white dark:bg-ink-800 text-ink-800 dark:text-ink-200 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-600 focus:border-transparent"
                        />
                      </div>

                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filteredChapters.map(c => (
                          <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white dark:hover:bg-ink-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedChapterIds.has(c.id)}
                              onChange={() => toggleChapter(c.id)}
                              className="w-4 h-4 rounded accent-accent-700"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-ink-800 dark:text-ink-200 truncate">{c.chapter}</p>
                              <p className="text-xs text-ink-400 dark:text-ink-500">{c.questions.length} questions</p>
                            </div>
                          </label>
                        ))}
                        {filteredChapters.length === 0 && (
                          <p className="text-xs text-ink-400 dark:text-ink-500 px-3 py-2">No chapters match "{chapterSearch}"</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={importFromBank}
                          disabled={selectedChapterIds.size === 0}
                          className="px-3 py-1.5 bg-accent-700 text-white rounded-lg text-xs font-medium hover:bg-accent-800 disabled:opacity-40"
                        >
                          Import All Selected
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={randomizeFromBank}
                            disabled={selectedChapterIds.size === 0}
                            className="px-3 py-1.5 bg-ink-700 dark:bg-ink-600 text-white rounded-lg text-xs font-medium hover:bg-ink-800 disabled:opacity-40"
                          >
                            Randomize
                          </button>
                          <input
                            type="number" min={1} max={50} value={randomN}
                            onChange={e => setRandomN(parseInt(e.target.value) || 5)}
                            className="w-14 border border-ink-300 dark:border-ink-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-ink-800 text-ink-800 dark:text-ink-200 focus:outline-none focus:ring-1 focus:ring-accent-600"
                          />
                          <span className="text-xs text-ink-400">questions</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {shuffleError && <p className="text-xs text-red-600 dark:text-red-400">{shuffleError}</p>}

              {newQuestions.length > 0 && (
                <GenerateAllButton missing={missingAnswers} busy={generatingAll} disabled={anyBusy} onClick={generateAllAnswers} />
              )}

              <div className="space-y-4">
                {newQuestions.map((q, idx) => (
                  <QuestionEditorCard
                    key={idx}
                    index={idx}
                    value={q}
                    showKeywords
                    busy={aiBusy?.idx === idx ? aiBusy.mode : null}
                    anyBusy={anyBusy}
                    error={generateError && aiBusy === null ? generateError : undefined}
                    keywordWarning={invalidKeywords(q.keywords ?? '', q.expectedAnswer).join(', ') || undefined}
                    onChange={patch => updateQuestion(idx, patch)}
                    onRemove={() => removeQuestion(idx)}
                    onGenerate={() => generateAnswer(idx)}
                    onRefine={mode => processAnswer(idx, mode)}
                    headerExtra={bankChapters.length > 0 ? (
                      <button
                        onClick={() => shuffleQuestion(idx)}
                        title="Shuffle with another bank question of same marks"
                        className="flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300"
                      >
                        <Icon name="refresh" className="w-3.5 h-3.5" />
                        Shuffle
                      </button>
                    ) : undefined}
                  />
                ))}
              </div>

              {newQuestions.length > 2 && (
                <GenerateAllButton missing={missingAnswers} busy={generatingAll} disabled={anyBusy} onClick={generateAllAnswers} />
              )}

              <button onClick={addQuestion}
                className="w-full py-2.5 border-2 border-dashed border-ink-300 dark:border-ink-600 text-ink-600 dark:text-ink-400 rounded-xl text-sm font-medium hover:border-accent-400 dark:hover:border-accent-600 hover:text-accent-700 dark:hover:text-accent-400 transition-colors">
                + Add Question
              </button>

              {newQuestions.length > 0 && (
                <>
                  <div className="border-t border-ink-100 dark:border-ink-800" />
                  <CheckingModeSelector value={checkingMode} onChange={m => dispatch({ type: 'SET_CHECKING_MODE', payload: m })} />
                </>
              )}
            </Card>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={cancelCreate}>Cancel</Button>
              <Button className="flex-1 py-3" onClick={saveNewSubject} disabled={!!step2CreateBlockedReason()}>
                {editingSubjectId ? 'Update Subject' : 'Save Subject'}
              </Button>
            </div>
          </div>
          <BlockedHint reason={step2CreateBlockedReason()} />
        </>
      )}

      {/* ── Step 3: Student info ─────────────────────────────────────────────── */}
      {step === 3 && (
        <>
          <div className="animate-fade-in space-y-6">
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100 tracking-tight">Student Details</h2>
                <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">Enter the student's name and section for this grading session.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">Student Name</label>
                <TextInput type="text" value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="e.g. Rahul Sharma" autoFocus />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">Student ID</label>
                <TextInput type="text" value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="e.g. STU-001" />
              </div>

              <SuggestInput label="Section" value={studentSection} onChange={setStudentSection}
                placeholder="e.g. A, B, Science, Commerce" suggestions={suggestions.sections ?? []} />

              {selectedSubject && (
                <div className="bg-ink-50 dark:bg-ink-800 rounded-xl px-4 py-3 text-xs text-ink-600 dark:text-ink-400 border border-ink-200 dark:border-ink-700 flex flex-wrap gap-x-4 gap-y-1">
                  <span><span className="font-medium text-ink-700 dark:text-ink-300">Term:</span> {examTerm}</span>
                  <span><span className="font-medium text-ink-700 dark:text-ink-300">Class:</span> {examClass}</span>
                  <span><span className="font-medium text-ink-700 dark:text-ink-300">Subject:</span> {selectedSubject.name}</span>
                  <span><span className="font-medium text-ink-700 dark:text-ink-300">Questions:</span> {selectedSubject.questions.length}</span>
                  <span><span className="font-medium text-ink-700 dark:text-ink-300">Mode:</span> {checkingMode.charAt(0).toUpperCase() + checkingMode.slice(1)}</span>
                </div>
              )}

              <div>
                <button onClick={() => setShowAdvanced(p => !p)}
                  className="flex items-center gap-2 text-xs text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300">
                  <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                    <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Advanced Settings
                </button>
                {showAdvanced && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">
                      Hugging Face API Key
                      <span className="ml-2 text-xs font-normal text-ink-400">(optional — semantic similarity fallback)</span>
                    </label>
                    <TextInput
                      type="password" value={hfApiKey} placeholder="hf_…"
                      onChange={e => dispatch({ type: 'SET_HF_API_KEY', payload: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-ink-400 dark:text-ink-500">Without this, keyword overlap is used as fallback.</p>
                  </div>
                )}
              </div>
            </Card>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(2)}>← Back</Button>
              <Button className="flex-1 py-3" onClick={handleStart} disabled={!!step3BlockedReason()}>
                {anyBusy ? <Spinner className="w-4 h-4" /> : null}
                Start Grading →
              </Button>
            </div>
          </div>
          <BlockedHint reason={step3BlockedReason()} />
        </>
      )}
    </div>
  );
}
