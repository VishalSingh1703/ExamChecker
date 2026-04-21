import { useState, useRef, useEffect } from 'react';
import type { AnswerKey, CheckingMode, SavedSubject, SubPart } from '../types';
import { useExam, useExamDispatch } from '../context/ExamContext';
import { loadChapters, type BankChapter } from '../services/questionBank';
import { SubPartsEditor } from './SubPartsEditor';
import { geminiUrl } from '../services/geminiModel';

// ── Class / Semester options ─────────────────────────────────────────────────

const CLASS_OPTIONS = [
  { group: 'School Classes', options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
  { group: 'University Semesters', options: Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) },
];

// ── Subjects localStorage helpers ────────────────────────────────────────────

function subjectsKey(userId: string) { return userId ? `exam-subjects-${userId}` : 'exam-subjects'; }
function suggestionsKey(userId: string) { return userId ? `exam-suggestions-${userId}` : 'exam-suggestions'; }

function loadSubjects(userId: string): SavedSubject[] {
  try { return JSON.parse(localStorage.getItem(subjectsKey(userId)) ?? '[]'); }
  catch { return []; }
}

function persistSubjects(userId: string, subjects: SavedSubject[]) {
  localStorage.setItem(subjectsKey(userId), JSON.stringify(subjects));
}

// ── Smart suggestions helpers ────────────────────────────────────────────────

interface Suggestions { terms: string[]; sections: string[] }

function loadSuggestions(userId: string): Suggestions {
  try { return JSON.parse(localStorage.getItem(suggestionsKey(userId)) ?? '{}'); }
  catch { return { terms: [], sections: [] }; }
}

function saveSuggestions(userId: string, s: Suggestions) {
  localStorage.setItem(suggestionsKey(userId), JSON.stringify(s));
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].slice(0, 10);
}

interface SuggestInputProps {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; suggestions: string[];
}

function SuggestInput({ label, value, onChange, placeholder, suggestions }: SuggestInputProps) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value);
  return (
    <div className="relative">
      <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden">
          {filtered.map(s => (
            <button key={s} onMouseDown={() => { onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700">{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [{ n: 1, label: 'Exam Context' }, { n: 2, label: 'Subject' }, { n: 3, label: 'Student' }];
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
              step > s.n ? 'bg-purple-700 border-purple-700 text-white'
                : step === s.n ? 'border-purple-700 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
                : 'border-slate-300 dark:border-zinc-600 text-slate-400 dark:text-zinc-500'}`}>
              {step > s.n ? (<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>) : s.n}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step === s.n ? 'text-purple-700 dark:text-purple-400' : 'text-slate-400 dark:text-zinc-500'}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-12 sm:w-20 mx-1 mb-4 rounded-full transition-colors ${step > s.n ? 'bg-purple-700' : 'bg-slate-200 dark:bg-zinc-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Checking mode selector (shared between step 2 and step-create-save) ───────

const MODES: CheckingMode[] = ['easy', 'medium', 'strict'];

function CheckingModeSelector({ value, onChange }: { value: CheckingMode; onChange: (m: CheckingMode) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Checking Mode</p>
      <div className="flex gap-2">
        {MODES.map(m => (
          <button key={m} onClick={() => onChange(m)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              value === m ? 'bg-purple-700 text-white' : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
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

// ── Blocked-reason hint (fixed bottom-left) ───────────────────────────────────

function BlockedHint({ reason }: { reason: string }) {
  if (!reason) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-xl shadow-sm text-xs font-medium max-w-xs print:hidden">
      <svg className="w-3.5 h-3.5 shrink-0 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      {reason}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ExamSetup({ userId = '' }: { userId?: string }) {
  const { hfApiKey, checkingMode } = useExam();
  const dispatch = useExamDispatch();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [examTerm, setExamTerm] = useState('');
  const [examClass, setExamClass] = useState('');

  // Step 2 — subject selection (all saved subjects; filtered by class in render)
  const [subjects, setSubjects] = useState<SavedSubject[]>(() => loadSubjects(userId));
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const classSubjects = subjects.filter(s => s.examClass === examClass);
  const [subjectMode, setSubjectMode] = useState<'select' | 'create'>('select');

  // Step 2 — new subject creation / editing
  const [newName, setNewName] = useState('');
  const [newQuestions, setNewQuestions] = useState<Array<{ question: string; expectedAnswer: string; marks: number; keywords: string; subparts: SubPart[]; diagram?: string }>>([]);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  // Step 3
  const [studentName, setStudentName] = useState('');
  const [studentSection, setStudentSection] = useState('');
  const [studentId, setStudentId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [shorteningIdx, setShorteningIdx] = useState<number | null>(null);
  const [definingIdx, setDefiningIdx] = useState<number | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  // Question bank import state
  const [bankChapters, setBankChapters] = useState<BankChapter[]>([]);
  const [showBankPanel, setShowBankPanel] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [randomN, setRandomN] = useState(5);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  const [chapterSearch, setChapterSearch] = useState('');

  const [suggestions] = useState<Suggestions>(() => loadSuggestions(userId));
  const fileRef = useRef<HTMLInputElement>(null);

  // Load bank chapters when entering create mode; re-filter when subject name changes
  useEffect(() => {
    if (subjectMode !== 'create' || !examClass) return;
    loadChapters(userId, examClass, newName.trim() || undefined).then(setBankChapters);
  }, [subjectMode, examClass, newName, userId]);

  // Derived answer key from selected subject
  const selectedSubject = subjects.find(s => s.id === selectedSubjectId) ?? null;
  const answerKey: AnswerKey | null = selectedSubject
    ? {
        exam: {
          title: selectedSubject.name,
          subject: selectedSubject.name,
          totalMarks: selectedSubject.questions.reduce((s, q) => s + q.marks, 0),
        },
        questions: selectedSubject.questions.map(q => ({ ...q, threshold: 0.6, keywords: q.keywords ?? [] })),
      }
    : null;

  // ── New subject actions ─────────────────────────────────────────────────────

  function addQuestion() {
    setNewQuestions(prev => [...prev, { question: '', expectedAnswer: '', marks: 5, keywords: '', subparts: [] }]);
  }

  function updateQuestion(idx: number, field: 'question' | 'expectedAnswer' | 'marks' | 'keywords', value: string | number) {
    setNewQuestions(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  }

  function updateQuestionSubparts(idx: number, subparts: SubPart[]) {
    setNewQuestions(prev => prev.map((q, i) => i === idx ? { ...q, subparts } : q));
  }

  function updateQuestionDiagram(idx: number, diagram: string | undefined) {
    setNewQuestions(prev => prev.map((q, i) => i === idx ? { ...q, diagram } : q));
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
      keywords: parseKeywords(q.keywords),
      subparts: q.subparts?.length ? q.subparts : undefined,
      diagram: q.diagram,
    }));
    let updated: SavedSubject[];
    if (editingSubjectId) {
      updated = subjects.map(s =>
        s.id === editingSubjectId ? { ...s, name: newName.trim(), questions } : s
      );
    } else {
      const subject: SavedSubject = { id: crypto.randomUUID(), name: newName.trim(), examClass, questions };
      updated = [...subjects, subject];
    }
    setSubjects(updated);
    persistSubjects(userId, updated);
    setSelectedSubjectId(editingSubjectId ?? updated[updated.length - 1].id);
    setSubjectMode('select');
    setNewName('');
    setNewQuestions([]);
    setEditingSubjectId(null);
  }

  function startEdit(s: SavedSubject) {
    setNewName(s.name);
    setNewQuestions(s.questions.map(q => ({
      question: q.question,
      expectedAnswer: q.expectedAnswer,
      marks: q.marks,
      keywords: (q.keywords ?? []).join(', '),
      subparts: q.subparts ?? [],
      diagram: q.diagram,
    })));
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
    const updated = subjects.filter(s => s.id !== id);
    setSubjects(updated);
    persistSubjects(userId, updated);
    if (selectedSubjectId === id) setSelectedSubjectId(null);
  }

  // ── Question Bank import helpers ────────────────────────────────────────────

  function toggleChapter(id: string) {
    setSelectedChapterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function importFromBank() {
    const allQs = bankChapters
      .filter(c => selectedChapterIds.has(c.id))
      .flatMap(c => c.questions);
    setNewQuestions(prev => [
      ...prev,
      ...allQs.map(q => ({
        question: q.question,
        expectedAnswer: q.expectedAnswer,
        marks: q.marks,
        keywords: (q.keywords ?? []).join(', '),
        subparts: q.subparts ?? [],
        diagram: q.diagram,
      })),
    ]);
    setShowBankPanel(false);
  }

  function randomizeFromBank() {
    const allQs = bankChapters
      .filter(c => selectedChapterIds.has(c.id))
      .flatMap(c => c.questions);
    const shuffled = [...allQs].sort(() => Math.random() - 0.5).slice(0, randomN);
    setNewQuestions(shuffled.map(q => ({
      question: q.question,
      expectedAnswer: q.expectedAnswer,
      marks: q.marks,
      keywords: (q.keywords ?? []).join(', '),
      subparts: q.subparts ?? [],
      diagram: q.diagram,
    })));
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
    setNewQuestions(prev => prev.map((q, i) => i === idx ? {
      question: pick.question,
      expectedAnswer: pick.expectedAnswer,
      marks: pick.marks,
      keywords: (pick.keywords ?? []).join(', '),
      subparts: pick.subparts ?? [],
      diagram: pick.diagram,
    } : q));
  }

  async function generateAnswer(idx: number) {
    const q = newQuestions[idx];
    if (!q.question.trim()) return;
    const key = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!key) { setGenerateError('VITE_GEMINI_API_KEY is not set.'); return; }
    setGeneratingIdx(idx);
    setGenerateError(null);
    try {
      const prompt = `You are an expert teacher creating a model answer for an exam.

Question: "${q.question}"
Class/Level: ${examClass}
Marks allocated: ${q.marks}

Write an ideal expected answer appropriate for a ${examClass} level student.
Guidelines:
- For Class 1–6 or 1–2 marks: 1-2 short sentences, simple vocabulary
- For Class 7–10 or 3–5 marks: 3-5 sentences with key terms, moderate detail
- For Class 11–12 or Semester or 6+ marks: detailed paragraphs, technical terminology, examples
- Write ONLY the answer text. No labels, no "Expected answer:", no formatting markers.`;

      const res = await fetch(
        geminiUrl(key),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
          }),
        }
      );
      if (!res.ok) throw new Error(`AI error: ${res.status}`);
      const data = await res.json();
      const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? '').join('').trim();
      if (!text) throw new Error('No text returned from AI.');
      updateQuestion(idx, 'expectedAnswer', text);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGeneratingIdx(null);
    }
  }

  async function processAnswer(idx: number, mode: 'shorten' | 'define') {
    const q = newQuestions[idx];
    if (!q.expectedAnswer.trim()) return;
    const key = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!key) { setGenerateError('VITE_GEMINI_API_KEY is not set.'); return; }
    if (mode === 'shorten') setShorteningIdx(idx); else setDefiningIdx(idx);
    setGenerateError(null);
    const prompt = mode === 'shorten'
      ? `You are an expert teacher. Shorten the following answer to be more concise while keeping every key point.

Question: "${q.question}"
Class/Level: ${examClass}
Marks allocated: ${q.marks}
Current answer: "${q.expectedAnswer}"

Remove repetition and filler. Preserve all essential facts and key terms.
Write ONLY the shortened answer. No labels, no formatting markers.`
      : `You are an expert teacher. Expand and enrich the following answer with definitions, examples, and detail appropriate for the class level.

Question: "${q.question}"
Class/Level: ${examClass}
Marks allocated: ${q.marks}
Current answer: "${q.expectedAnswer}"

Add relevant explanations and technical vocabulary for ${examClass}. Scale depth to ${q.marks} mark${q.marks !== 1 ? 's' : ''}.
Write ONLY the expanded answer. No labels, no formatting markers.`;
    try {
      const res = await fetch(
        geminiUrl(key),
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 800 } }) }
      );
      if (!res.ok) throw new Error(`AI error: ${res.status}`);
      const data = await res.json();
      const text = ((data.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string }>)
        .map(p => p.text ?? '').join('').trim();
      if (!text) throw new Error('No text returned.');
      updateQuestion(idx, 'expectedAnswer', text);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      if (mode === 'shorten') setShorteningIdx(null); else setDefiningIdx(null);
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
    saveSuggestions(userId, {
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

  // ── Blocked reason strings ─────────────────────────────────────────────────

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
    if (newQuestions.some(q => !q.expectedAnswer.trim())) return 'All questions need an expected answer — type one or click "Generate Answer".';
    if (newQuestions.some(q => q.marks === 0)) return 'Enter marks for all questions.';
    if (newQuestions.some(q => q.marks > 20)) return 'Marks cannot exceed 20 for any question.';
    if (newQuestions.some(q => invalidKeywords(q.keywords, q.expectedAnswer).length > 0))
      return 'Some keywords are not found in their expected answer — fix or remove them.';
    return '';
  }

  function step3BlockedReason(): string {
    if (!studentName.trim()) return "Enter the student's name.";
    if (!studentId.trim()) return 'Enter the student ID.';
    if (!studentSection.trim()) return "Enter the student's section.";
    return '';
  }

  // ══ RENDER ══════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-2xl mx-auto">
      <StepIndicator step={step} />

      {/* ── Step 1: Exam Context ─────────────────────────────────────────────── */}
      {step === 1 && (
        <><div key="step1" className="animate-fade-in space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">Exam Context</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">Define the exam term and class before selecting the answer key.</p>
            </div>

            <SuggestInput label="Exam Term" value={examTerm} onChange={setExamTerm}
              placeholder="e.g. Term 1, Mid-Term, Final Exam" suggestions={suggestions.terms ?? []} />

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Class</label>
              <select
                value={examClass}
                onChange={e => setExamClass(e.target.value)}
                className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200"
              >
                <option value="">Select a class…</option>
                {CLASS_OPTIONS.map(group => (
                  <optgroup key={group.group} label={group.group}>
                    {group.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!!step1BlockedReason()}
            className="w-full py-3 bg-purple-700 text-white rounded-xl font-semibold text-sm hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            Continue →
          </button>
        </div>
        <BlockedHint reason={step1BlockedReason()} /></>
      )}

      {/* ── Step 2: Subject selection ─────────────────────────────────────────── */}
      {step === 2 && subjectMode === 'select' && (
        <><div key="step2-select" className="animate-fade-in space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-purple-700 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">Select Subject</h2>
                <p className="text-xs text-slate-400 dark:text-zinc-500">Choose a subject with a pre-configured answer key.</p>
              </div>
            </div>

            {/* Subject cards grid — only subjects for the selected class */}
            <div className="grid grid-cols-2 gap-3">
              {classSubjects.map(s => {
                const selected = selectedSubjectId === s.id;
                const total = s.questions.reduce((acc, q) => acc + q.marks, 0);
                return (
                  <div
                    key={s.id}
                    className={`rounded-2xl border-2 transition-colors overflow-hidden ${
                      selected
                        ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/20'
                        : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800'
                    }`}
                  >
                    {/* Selectable area */}
                    <button onClick={() => setSelectedSubjectId(s.id)} className="w-full text-left p-4">
                      <div className="flex items-start justify-between">
                        <p className="font-semibold text-gray-900 dark:text-zinc-100 text-sm">{s.name}</p>
                        {selected && (
                          <svg className="w-4 h-4 text-purple-700 dark:text-purple-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">{s.questions.length} Question{s.questions.length !== 1 ? 's' : ''}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-400">{total} Total Marks</p>
                    </button>
                    {/* Action footer */}
                    <div className={`flex divide-x text-xs border-t ${selected ? 'border-purple-200 dark:border-purple-800 divide-purple-200 dark:divide-purple-800' : 'border-slate-100 dark:border-zinc-700 divide-slate-100 dark:divide-zinc-700'}`}>
                      <button
                        onClick={() => startEdit(s)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 dark:text-zinc-400 hover:text-purple-700 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                      <button
                        onClick={() => deleteSubject(s.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* New Subject dashed card */}
              <button
                onClick={() => { setSubjectMode('create'); addQuestion(); }}
                className="text-left rounded-xl p-4 border-2 border-dashed border-slate-300 dark:border-zinc-600 hover:border-slate-400 dark:hover:border-zinc-500 flex flex-col items-center justify-center gap-1 bg-transparent transition-colors min-h-[90px]"
              >
                <svg className="w-6 h-6 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm text-slate-500 dark:text-zinc-400">New Subject</span>
              </button>
            </div>

            {/* Divider */}
            {selectedSubjectId && (
              <>
                <div className="border-t border-slate-100 dark:border-zinc-800" />
                <CheckingModeSelector value={checkingMode} onChange={m => dispatch({ type: 'SET_CHECKING_MODE', payload: m })} />
              </>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStep(1); setSelectedSubjectId(null); }}
              className="px-5 py-3 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700">
              ← Back
            </button>
            <button onClick={() => setStep(3)} disabled={!!step2SelectBlockedReason()}
              className="flex-1 py-3 bg-purple-700 text-white rounded-xl font-semibold text-sm hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
              Continue →
            </button>
          </div>
        </div>
        <BlockedHint reason={step2SelectBlockedReason()} /></>
      )}

      {/* ── Step 2: Create new subject ─────────────────────────────────────────── */}
      {step === 2 && subjectMode === 'create' && (
        <><div key="step2-create" className="animate-fade-in space-y-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">{editingSubjectId ? 'Edit Subject' : 'Create New Subject'}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{editingSubjectId ? 'Update questions and expected answers for this subject.' : 'Add questions and expected answers. This subject will be saved for future use.'}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Subject Name</label>
              <input
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                autoFocus placeholder="e.g. Biology, Mathematics"
                className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
              />
            </div>

            {/* Import from Question Bank */}
            {bankChapters.length > 0 && (
              <div className="border border-dashed border-purple-300 dark:border-purple-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => { setShowBankPanel(p => !p); setChapterSearch(''); }}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Import from Question Bank
                    <span className="text-xs text-purple-600 dark:text-purple-500 font-normal">({bankChapters.length} chapter{bankChapters.length !== 1 ? 's' : ''}{newName.trim() ? ` · ${newName.trim()}` : ''})</span>
                  </span>
                  <svg className={`w-4 h-4 transition-transform ${showBankPanel ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showBankPanel && (
                  <div className="px-4 pb-4 space-y-3 border-t border-purple-100 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-900/10">
                    {/* Search */}
                    <div className="relative pt-3">
                      <svg className="absolute left-3 top-1/2 mt-1.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        value={chapterSearch}
                        onChange={e => setChapterSearch(e.target.value)}
                        placeholder="Search chapters…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent"
                      />
                    </div>

                    {/* Chapter checkboxes */}
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {bankChapters
                        .filter(c => !chapterSearch.trim() || c.chapter.toLowerCase().includes(chapterSearch.toLowerCase()))
                        .map(c => (
                          <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white dark:hover:bg-gray-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedChapterIds.has(c.id)}
                              onChange={() => toggleChapter(c.id)}
                              className="w-4 h-4 rounded accent-purple-700"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 dark:text-zinc-200 truncate">{c.chapter}</p>
                              <p className="text-xs text-slate-400 dark:text-zinc-500">{c.questions.length} questions</p>
                            </div>
                          </label>
                        ))}
                      {bankChapters.filter(c => !chapterSearch.trim() || c.chapter.toLowerCase().includes(chapterSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-slate-400 dark:text-zinc-500 px-3 py-2">No chapters match "{chapterSearch}"</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={importFromBank}
                        disabled={selectedChapterIds.size === 0}
                        className="px-3 py-1.5 bg-purple-700 text-white rounded-lg text-xs font-medium hover:bg-purple-800 disabled:opacity-40"
                      >
                        Import All Selected
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={randomizeFromBank}
                          disabled={selectedChapterIds.size === 0}
                          className="px-3 py-1.5 bg-zinc-700 dark:bg-zinc-600 text-white rounded-lg text-xs font-medium hover:bg-zinc-800 disabled:opacity-40"
                        >
                          Randomize
                        </button>
                        <input
                          type="number" min={1} max={50} value={randomN}
                          onChange={e => setRandomN(parseInt(e.target.value) || 5)}
                          className="w-14 border border-slate-300 dark:border-zinc-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-700"
                        />
                        <span className="text-xs text-slate-400">questions</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {shuffleError && (
              <p className="text-xs text-red-600 dark:text-red-400">{shuffleError}</p>
            )}

            {/* Generate All — top */}
            {newQuestions.length > 0 && (() => {
              const missing = newQuestions.filter(q => q.question.trim() && !q.expectedAnswer.trim()).length;
              return (
                <button onClick={generateAllAnswers}
                  disabled={generatingAll || generatingIdx !== null || shorteningIdx !== null || definingIdx !== null || missing === 0}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {generatingAll
                    ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Generating all answers…</>
                    : `Generate All Answers${missing > 0 ? ` (${missing} missing)` : ''}`}
                </button>
              );
            })()}

            {/* Questions */}
            <div className="space-y-4">
              {newQuestions.map((q, idx) => (
                <div key={idx} className="border border-slate-200 dark:border-zinc-700 rounded-xl p-4 space-y-3 bg-slate-50 dark:bg-zinc-800/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">Question {idx + 1}</span>
                    <div className="flex items-center gap-2">
                      {bankChapters.length > 0 && (
                        <button
                          onClick={() => shuffleQuestion(idx)}
                          title="Shuffle with another bank question of same marks"
                          className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Shuffle
                        </button>
                      )}
                      <button onClick={() => removeQuestion(idx)}
                        className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">Remove</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Question</label>
                    <textarea
                      value={q.question} onChange={e => updateQuestion(idx, 'question', e.target.value)}
                      rows={2} placeholder="Enter the question…"
                      className="w-full border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-y bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
                    />
                    <SubPartsEditor
                      subparts={q.subparts}
                      diagram={q.diagram}
                      onSubpartsChange={sp => updateQuestionSubparts(idx, sp)}
                      onDiagramChange={d => updateQuestionDiagram(idx, d)}
                    />
                  </div>
                  <div>
                    {/* Expected Answer label + action buttons */}
                    <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400">Expected Answer</label>
                      <div className="flex items-center gap-1">
                        {/* − Shorten */}
                        <button type="button" onClick={() => processAnswer(idx, 'shorten')}
                          disabled={shorteningIdx !== null || definingIdx !== null || generatingIdx !== null || generatingAll || !q.expectedAnswer.trim()}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          {shorteningIdx === idx ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> : '−'}
                          {shorteningIdx === idx ? 'Shortening…' : 'Shorten'}
                        </button>
                        {/* Generate Answer */}
                        <button type="button" onClick={() => generateAnswer(idx)}
                          disabled={generatingIdx !== null || shorteningIdx !== null || definingIdx !== null || generatingAll || !q.question.trim()}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                          {generatingIdx === idx ? (
                            <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Generating…</>
                          ) : (
                            <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>Generate</>
                          )}
                        </button>
                        {/* + Define */}
                        <button type="button" onClick={() => processAnswer(idx, 'define')}
                          disabled={shorteningIdx !== null || definingIdx !== null || generatingIdx !== null || generatingAll || !q.expectedAnswer.trim()}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          {definingIdx === idx ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> : '+'}
                          {definingIdx === idx ? 'Defining…' : 'Define'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={q.expectedAnswer} onChange={e => updateQuestion(idx, 'expectedAnswer', e.target.value)}
                      rows={3} placeholder="Enter the ideal/expected answer…"
                      className="w-full border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-y bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
                    />
                    {generateError && generatingIdx === null && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{generateError}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">
                      Keywords
                      <span className="ml-1.5 font-normal text-slate-400">(optional · comma-separated · must appear in the answer above)</span>
                    </label>
                    <textarea
                      value={q.keywords} onChange={e => updateQuestion(idx, 'keywords', e.target.value)}
                      rows={2} placeholder="e.g. photosynthesis, chlorophyll, glucose"
                      className="w-full border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-none bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
                    />
                    {invalidKeywords(q.keywords, q.expectedAnswer).length > 0 && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        Not found in expected answer: <span className="font-medium">{invalidKeywords(q.keywords, q.expectedAnswer).join(', ')}</span>
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Marks</label>
                    <input
                      type="text" inputMode="numeric" pattern="[0-9]*"
                      value={q.marks === 0 ? '' : String(q.marks)}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        updateQuestion(idx, 'marks', raw === '' ? 0 : parseInt(raw, 10));
                      }}
                      placeholder="1–20"
                      className={`w-24 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 ${
                        q.marks === 0 || q.marks > 20
                          ? 'border-red-400 dark:border-red-600'
                          : 'border-slate-300 dark:border-zinc-700'
                      }`}
                    />
                    {q.marks === 0 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Marks are required.</p>}
                    {q.marks > 20 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Marks cannot exceed 20.</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Generate All — bottom */}
            {newQuestions.length > 0 && (() => {
              const missing = newQuestions.filter(q => q.question.trim() && !q.expectedAnswer.trim()).length;
              return (
                <button onClick={generateAllAnswers}
                  disabled={generatingAll || generatingIdx !== null || shorteningIdx !== null || definingIdx !== null || missing === 0}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {generatingAll
                    ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Generating all answers…</>
                    : `Generate All Answers${missing > 0 ? ` (${missing} missing)` : ''}`}
                </button>
              );
            })()}

            <button onClick={addQuestion}
              className="w-full py-2.5 border-2 border-dashed border-slate-300 dark:border-zinc-600 text-slate-600 dark:text-zinc-400 rounded-xl text-sm font-medium hover:border-purple-400 dark:hover:border-purple-600 hover:text-purple-700 dark:hover:text-purple-400 transition-colors">
              + Add Question
            </button>

            {/* Checking mode — always visible once questions exist */}
            {newQuestions.length > 0 && (
              <>
                <div className="border-t border-slate-100 dark:border-zinc-800" />
                <CheckingModeSelector value={checkingMode} onChange={m => dispatch({ type: 'SET_CHECKING_MODE', payload: m })} />
              </>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={cancelCreate}
              className="px-5 py-3 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700">
              Cancel
            </button>
            <button onClick={saveNewSubject} disabled={!!step2CreateBlockedReason()}
              className="flex-1 py-3 bg-zinc-800 dark:bg-zinc-700 text-white rounded-xl font-semibold text-sm hover:bg-zinc-900 dark:hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
              {editingSubjectId ? 'Update Subject' : 'Save Subject'}
            </button>
          </div>
        </div>
        <BlockedHint reason={step2CreateBlockedReason()} /></>
      )}

      {/* ── Step 3: Student Info ─────────────────────────────────────────────── */}
      {step === 3 && (
        <><div key="step3" className="animate-fade-in space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">Student Details</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">Enter the student's name and section for this grading session.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Student Name</label>
              <input
                type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                placeholder="e.g. Rahul Sharma" autoFocus
                className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Student ID</label>
              <input
                type="text" value={studentId} onChange={e => setStudentId(e.target.value)}
                placeholder="e.g. STU-001"
                className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
              />
            </div>

            <SuggestInput label="Section" value={studentSection} onChange={setStudentSection}
              placeholder="e.g. A, B, Science, Commerce" suggestions={suggestions.sections ?? []} />

            {/* Session summary */}
            {selectedSubject && (
              <div className="bg-slate-50 dark:bg-zinc-800 rounded-xl px-4 py-3 text-xs text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-medium text-slate-700 dark:text-zinc-300">Term:</span> {examTerm}</span>
                <span><span className="font-medium text-slate-700 dark:text-zinc-300">Class:</span> {examClass}</span>
                <span><span className="font-medium text-slate-700 dark:text-zinc-300">Subject:</span> {selectedSubject.name}</span>
                <span><span className="font-medium text-slate-700 dark:text-zinc-300">Questions:</span> {selectedSubject.questions.length}</span>
                <span><span className="font-medium text-slate-700 dark:text-zinc-300">Mode:</span> {checkingMode.charAt(0).toUpperCase() + checkingMode.slice(1)}</span>
              </div>
            )}

            {/* Advanced: HF key */}
            <div>
              <button onClick={() => setShowAdvanced(p => !p)}
                className="flex items-center gap-2 text-xs text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300">
                <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 6 10">
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Advanced Settings
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">
                    Hugging Face API Key
                    <span className="ml-2 text-xs font-normal text-slate-400">(optional — semantic similarity)</span>
                  </label>
                  <input
                    type="password" value={hfApiKey} placeholder="hf_…"
                    onChange={e => dispatch({ type: 'SET_HF_API_KEY', payload: e.target.value })}
                    className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500"
                  />
                  <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">Without this, keyword overlap is used as fallback.</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)}
              className="px-5 py-3 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700">
              ← Back
            </button>
            <button onClick={handleStart} disabled={!!step3BlockedReason()}
              className="flex-1 py-3 bg-purple-700 text-white rounded-xl font-semibold text-sm hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
              Start Grading →
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" />
        </div>
        <BlockedHint reason={step3BlockedReason()} /></>
      )}
    </div>
  );
}
