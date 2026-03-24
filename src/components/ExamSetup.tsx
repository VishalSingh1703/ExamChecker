import { useState, useRef } from 'react';
import type { AnswerKey, CheckingMode, SavedSubject } from '../types';
import { useExam, useExamDispatch } from '../context/ExamContext';

// ── Class / Semester options ─────────────────────────────────────────────────

const CLASS_OPTIONS = [
  { group: 'School Classes', options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
  { group: 'University Semesters', options: Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) },
];

// ── Subjects localStorage helpers ────────────────────────────────────────────

function loadSubjects(): SavedSubject[] {
  try { return JSON.parse(localStorage.getItem('exam-subjects') ?? '[]'); }
  catch { return []; }
}

function persistSubjects(subjects: SavedSubject[]) {
  localStorage.setItem('exam-subjects', JSON.stringify(subjects));
}

// ── Smart suggestions helpers ────────────────────────────────────────────────

interface Suggestions { terms: string[]; sections: string[] }

function loadSuggestions(): Suggestions {
  try { return JSON.parse(localStorage.getItem('exam-suggestions') ?? '{}'); }
  catch { return { terms: [], sections: [] }; }
}

function saveSuggestions(s: Suggestions) {
  localStorage.setItem('exam-suggestions', JSON.stringify(s));
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
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
          {filtered.map(s => (
            <button key={s} onMouseDown={() => { onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">{s}</button>
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
              step > s.n ? 'bg-blue-600 border-blue-600 text-white'
                : step === s.n ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500'}`}>
              {step > s.n ? (<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>) : s.n}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step === s.n ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-12 sm:w-20 mx-1 mb-4 rounded-full transition-colors ${step > s.n ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
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
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Checking Mode</p>
      <div className="flex gap-2">
        {MODES.map(m => (
          <button key={m} onClick={() => onChange(m)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              value === m ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ExamSetup() {
  const { hfApiKey, checkingMode } = useExam();
  const dispatch = useExamDispatch();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [examTerm, setExamTerm] = useState('');
  const [examClass, setExamClass] = useState('');

  // Step 2 — subject selection (all saved subjects; filtered by class in render)
  const [subjects, setSubjects] = useState<SavedSubject[]>(loadSubjects);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const classSubjects = subjects.filter(s => s.examClass === examClass);
  const [subjectMode, setSubjectMode] = useState<'select' | 'create'>('select');

  // Step 2 — new subject creation
  const [newName, setNewName] = useState('');
  const [newQuestions, setNewQuestions] = useState<Array<{ question: string; expectedAnswer: string; marks: number }>>([]);

  // Step 3
  const [studentName, setStudentName] = useState('');
  const [studentSection, setStudentSection] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [suggestions] = useState<Suggestions>(loadSuggestions);
  const fileRef = useRef<HTMLInputElement>(null);

  // Derived answer key from selected subject
  const selectedSubject = subjects.find(s => s.id === selectedSubjectId) ?? null;
  const answerKey: AnswerKey | null = selectedSubject
    ? {
        exam: {
          title: selectedSubject.name,
          subject: selectedSubject.name,
          totalMarks: selectedSubject.questions.reduce((s, q) => s + q.marks, 0),
        },
        questions: selectedSubject.questions.map(q => ({ ...q, threshold: 0.6 })),
      }
    : null;

  // ── New subject actions ─────────────────────────────────────────────────────

  function addQuestion() {
    setNewQuestions(prev => [...prev, { question: '', expectedAnswer: '', marks: 5 }]);
  }

  function updateQuestion(idx: number, field: 'question' | 'expectedAnswer' | 'marks', value: string | number) {
    setNewQuestions(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  }

  function removeQuestion(idx: number) {
    setNewQuestions(prev => prev.filter((_, i) => i !== idx));
  }

  function saveNewSubject() {
    if (!newName.trim() || newQuestions.length === 0) return;
    const subject: SavedSubject = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      examClass,
      questions: newQuestions.map((q, i) => ({
        id: i + 1,
        question: q.question,
        expectedAnswer: q.expectedAnswer,
        marks: Number(q.marks) || 5,
      })),
    };
    const updated = [...subjects, subject];
    setSubjects(updated);
    persistSubjects(updated);
    setSelectedSubjectId(subject.id);
    setSubjectMode('select');
    setNewName('');
    setNewQuestions([]);
  }

  function cancelCreate() {
    setSubjectMode('select');
    setNewName('');
    setNewQuestions([]);
  }

  // ── Start grading ───────────────────────────────────────────────────────────

  function handleStart() {
    if (!answerKey || !studentName.trim() || !studentSection.trim()) return;
    const s = loadSuggestions();
    saveSuggestions({
      terms: dedupe([examTerm, ...(s.terms ?? [])]),
      sections: dedupe([studentSection, ...(s.sections ?? [])]),
    });
    dispatch({ type: 'SET_CHECKING_MODE', payload: checkingMode });
    dispatch({ type: 'SET_EXAM_META', payload: { examTerm, examClass } });
    dispatch({ type: 'SET_STUDENT_INFO', payload: { studentName, studentSection } });
    dispatch({ type: 'SET_ANSWER_KEY', payload: answerKey });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'grade' });
  }

  const canSaveSubject = newName.trim().length > 0 && newQuestions.length > 0
    && newQuestions.every(q => q.question.trim() && q.expectedAnswer.trim());

  // ══ RENDER ══════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-2xl mx-auto">
      <StepIndicator step={step} />

      {/* ── Step 1: Exam Context ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div key="step1" className="animate-fade-in space-y-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Exam Context</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Define the exam term and class before selecting the answer key.</p>
            </div>

            <SuggestInput label="Exam Term" value={examTerm} onChange={setExamTerm}
              placeholder="e.g. Term 1, Mid-Term, Final Exam" suggestions={suggestions.terms ?? []} />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class</label>
              <select
                value={examClass}
                onChange={e => setExamClass(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
            disabled={!examTerm.trim() || !examClass}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            Continue →
          </button>
        </div>
      )}

      {/* ── Step 2: Subject selection ─────────────────────────────────────────── */}
      {step === 2 && subjectMode === 'select' && (
        <div key="step2-select" className="animate-fade-in space-y-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Select Subject</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">Choose a subject with a pre-configured answer key.</p>
              </div>
            </div>

            {/* Subject cards grid — only subjects for the selected class */}
            <div className="grid grid-cols-2 gap-3">
              {classSubjects.map(s => {
                const selected = selectedSubjectId === s.id;
                const total = s.questions.reduce((acc, q) => acc + q.marks, 0);
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSubjectId(s.id)}
                    className={`relative text-left rounded-xl p-4 border-2 transition-colors ${
                      selected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{s.name}</p>
                      {selected && (
                        <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.questions.length} Question{s.questions.length !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{total} Total Marks</p>
                  </button>
                );
              })}

              {/* New Subject dashed card */}
              <button
                onClick={() => { setSubjectMode('create'); addQuestion(); }}
                className="text-left rounded-xl p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 flex flex-col items-center justify-center gap-1 bg-transparent transition-colors min-h-[90px]"
              >
                <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm text-gray-500 dark:text-gray-400">New Subject</span>
              </button>
            </div>

            {/* Divider */}
            {selectedSubjectId && (
              <>
                <div className="border-t border-gray-100 dark:border-gray-800" />
                <CheckingModeSelector value={checkingMode} onChange={m => dispatch({ type: 'SET_CHECKING_MODE', payload: m })} />
              </>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStep(1); setSelectedSubjectId(null); }}
              className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
              ← Back
            </button>
            <button onClick={() => setStep(3)} disabled={!selectedSubjectId}
              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Create new subject ─────────────────────────────────────────── */}
      {step === 2 && subjectMode === 'create' && (
        <div key="step2-create" className="animate-fade-in space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Create New Subject</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add questions and expected answers. This subject will be saved for future use.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject Name</label>
              <input
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                autoFocus placeholder="e.g. Biology, Mathematics"
                className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>

            {/* Questions */}
            <div className="space-y-4">
              {newQuestions.map((q, idx) => (
                <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Question {idx + 1}</span>
                    <button onClick={() => removeQuestion(idx)}
                      className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">Remove</button>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Question</label>
                    <textarea
                      value={q.question} onChange={e => updateQuestion(idx, 'question', e.target.value)}
                      rows={2} placeholder="Enter the question…"
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expected Answer</label>
                    <textarea
                      value={q.expectedAnswer} onChange={e => updateQuestion(idx, 'expectedAnswer', e.target.value)}
                      rows={3} placeholder="Enter the ideal/expected answer…"
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Marks</label>
                    <input
                      type="number" min={1} max={100} value={q.marks}
                      onChange={e => updateQuestion(idx, 'marks', parseInt(e.target.value) || 5)}
                      className="w-24 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addQuestion}
              className="w-full py-2.5 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-xl text-sm font-medium hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              + Add Question
            </button>

            {/* Divider */}
            {newQuestions.length > 0 && canSaveSubject && (
              <>
                <div className="border-t border-gray-100 dark:border-gray-800" />
                <CheckingModeSelector value={checkingMode} onChange={m => dispatch({ type: 'SET_CHECKING_MODE', payload: m })} />
              </>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={cancelCreate}
              className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button onClick={saveNewSubject} disabled={!canSaveSubject}
              className="flex-1 py-3 bg-gray-800 dark:bg-gray-700 text-white rounded-xl font-semibold text-sm hover:bg-gray-900 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed">
              Save Subject
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Student Info ─────────────────────────────────────────────── */}
      {step === 3 && (
        <div key="step3" className="animate-fade-in space-y-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Student Details</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Enter the student's name and section for this grading session.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Student Name</label>
              <input
                type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                placeholder="e.g. Rahul Sharma" autoFocus
                className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>

            <SuggestInput label="Section" value={studentSection} onChange={setStudentSection}
              placeholder="e.g. A, B, Science, Commerce" suggestions={suggestions.sections ?? []} />

            {/* Session summary */}
            {selectedSubject && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-medium text-gray-700 dark:text-gray-300">Term:</span> {examTerm}</span>
                <span><span className="font-medium text-gray-700 dark:text-gray-300">Class:</span> {examClass}</span>
                <span><span className="font-medium text-gray-700 dark:text-gray-300">Subject:</span> {selectedSubject.name}</span>
                <span><span className="font-medium text-gray-700 dark:text-gray-300">Questions:</span> {selectedSubject.questions.length}</span>
                <span><span className="font-medium text-gray-700 dark:text-gray-300">Mode:</span> {checkingMode.charAt(0).toUpperCase() + checkingMode.slice(1)}</span>
              </div>
            )}

            {/* Advanced: HF key */}
            <div>
              <button onClick={() => setShowAdvanced(p => !p)}
                className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 6 10">
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Advanced Settings
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Hugging Face API Key
                    <span className="ml-2 text-xs font-normal text-gray-400">(optional — semantic similarity)</span>
                  </label>
                  <input
                    type="password" value={hfApiKey} placeholder="hf_…"
                    onChange={e => dispatch({ type: 'SET_HF_API_KEY', payload: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                  />
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Without this, keyword overlap is used as fallback.</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)}
              className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
              ← Back
            </button>
            <button onClick={handleStart} disabled={!answerKey || !studentName.trim() || !studentSection.trim()}
              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
              Start Grading →
            </button>
          </div>

          <input ref={fileRef} type="file" accept=".json" className="hidden" />
        </div>
      )}
    </div>
  );
}
