import { useState, useRef } from 'react';
import { saveChapter, type BankQuestion } from '../services/questionBank';

// ── Class options (same as ExamSetup) ────────────────────────────────────────

const CLASS_OPTIONS = [
  { group: 'School Classes', options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
  { group: 'University Semesters', options: Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) },
];

// ── Gemini helpers ────────────────────────────────────────────────────────────

function getKey(): string {
  return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
}

async function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function extractQuestionsFromImage(file: File): Promise<string[]> {
  const key = getKey();
  if (!key) throw new Error('VITE_GEMINI_API_KEY is not set.');
  const base64 = await toBase64(file);
  const prompt = `Extract all exam or textbook questions from this image.
Return a JSON array of strings where each item is one complete question (strip leading numbers like "1." or "Q1.").
Return ONLY the JSON array — no explanation, no markdown.`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
          { text: prompt },
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Gemini error ${res.status}`);
  }
  const data = await res.json();
  const raw = ((data.candidates?.[0]?.content?.parts ?? []) as { text?: string }[])
    .map(p => p.text ?? '').join('').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse questions from image response.');
  return (JSON.parse(match[0]) as string[]).map(s => s.trim()).filter(Boolean);
}

async function geminiGenerateAnswer(question: string, cls: string, marks: number): Promise<string> {
  const key = getKey();
  if (!key) throw new Error('VITE_GEMINI_API_KEY is not set.');
  const prompt = `You are an expert teacher. Write an ideal model answer for the following exam question.

Question: "${question}"
Class/Level: ${cls}
Marks allocated: ${marks}

Guidelines:
- For 1–2 marks: 1–2 short sentences, simple vocabulary
- For 3–5 marks: 3–5 sentences with key terms
- For 6+ marks: detailed paragraphs with examples
Write ONLY the answer text. No labels, no formatting markers.`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const data = await res.json();
  return ((data.candidates?.[0]?.content?.parts ?? []) as { text?: string }[])
    .map(p => p.text ?? '').join('').trim();
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
      done ? 'bg-blue-600 border-blue-600 text-white'
        : active ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
        : 'border-gray-300 dark:border-gray-600 text-gray-400'
    }`}>
      {done ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : n}
    </div>
  );
}

// ── EditableQuestion local type ───────────────────────────────────────────────

interface EditableQ {
  id: string;
  question: string;
  expectedAnswer: string;
  marks: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export function QuestionBankView({ userId = '', onBack }: { userId?: string; onBack: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1
  const [cls, setCls] = useState('');
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');

  // Step 2
  const [questions, setQuestions] = useState<EditableQ[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function addManual() {
    setQuestions(prev => [...prev, { id: crypto.randomUUID(), question: '', expectedAnswer: '', marks: 5 }]);
  }

  function updateQ(id: string, field: keyof EditableQ, value: string | number) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  }

  function removeQ(id: string) {
    setQuestions(prev => prev.filter(q => q.id !== id));
  }

  async function handlePhotoUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setExtracting(true);
    setExtractError('');
    try {
      const extracted: string[] = [];
      for (const file of Array.from(files)) {
        extracted.push(...await extractQuestionsFromImage(file));
      }
      setQuestions(prev => [
        ...prev,
        ...extracted.map(q => ({ id: crypto.randomUUID(), question: q, expectedAnswer: '', marks: 5 })),
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
    setGeneratingId(id);
    setGenErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const answer = await geminiGenerateAnswer(q.question, cls, q.marks);
      updateQ(id, 'expectedAnswer', answer);
    } catch (err) {
      setGenErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed.' }));
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleSave() {
    if (questions.length === 0) return;
    setSaving(true);
    const bankQs: BankQuestion[] = questions.map(q => ({
      id: q.id,
      question: q.question.trim(),
      expectedAnswer: q.expectedAnswer.trim(),
      marks: Number(q.marks) || 5,
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Question Bank</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">Upload questions from textbooks or enter them manually.</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        <StepDot n={1} active={step === 1} done={step > 1} />
        <div className={`flex-1 h-0.5 rounded-full ${step > 1 ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
        <StepDot n={2} active={step === 2} done={false} />
      </div>

      {/* ── Step 1: Info ─────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Chapter Details</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Questions will be saved under this class / subject / chapter.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class</label>
            <select
              value={cls} onChange={e => setCls(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            >
              <option value="">Select a class…</option>
              {CLASS_OPTIONS.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
            <input
              type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Biology, Mathematics, History"
              className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chapter Name</label>
            <input
              type="text" value={chapter} onChange={e => setChapter(e.target.value)}
              placeholder="e.g. Chapter 3 – Photosynthesis"
              className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!cls || !subject.trim() || !chapter.trim()}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            Continue →
          </button>
        </div>
      )}

      {/* ── Step 2: Questions ────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Chapter badge */}
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium">{cls}</span>
            <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium">{subject}</span>
            <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium">{chapter}</span>
          </div>

          {/* Upload photo strip */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <input ref={photoRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handlePhotoUpload(e.target.files)} />
            <div className="flex items-center gap-3">
              <button
                onClick={() => photoRef.current?.click()}
                disabled={extracting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {extracting ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {extracting ? 'Extracting…' : 'Upload Photo of Questions'}
              </button>
              <span className="text-xs text-gray-400 dark:text-gray-500">Gemini will extract all questions automatically</span>
            </div>
            {extractError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{extractError}</p>}
          </div>

          {/* Question list */}
          {questions.length > 0 && (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <div key={q.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Q{idx + 1}</span>
                    <button onClick={() => removeQ(q.id)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300">Remove</button>
                  </div>

                  {/* Question text */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Question</label>
                    <textarea
                      value={q.question} onChange={e => updateQ(q.id, 'question', e.target.value)}
                      rows={2} placeholder="Enter question…"
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                  </div>

                  {/* Marks + Generate */}
                  <div className="flex items-end gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Marks</label>
                      <input
                        type="number" min={1} max={100} value={q.marks}
                        onChange={e => updateQ(q.id, 'marks', parseInt(e.target.value) || 5)}
                        className="w-20 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                      />
                    </div>
                    <button
                      onClick={() => handleGenerate(q.id)}
                      disabled={!q.question.trim() || generatingId !== null}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 text-xs font-medium hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generatingId === q.id ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                        </svg>
                      )}
                      {generatingId === q.id ? 'Generating…' : 'Generate Answer'}
                    </button>
                  </div>

                  {/* Expected answer */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Expected Answer</label>
                    <textarea
                      value={q.expectedAnswer} onChange={e => updateQ(q.id, 'expectedAnswer', e.target.value)}
                      rows={3} placeholder="Enter or generate the expected answer…"
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                    {genErrors[q.id] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{genErrors[q.id]}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add question manually */}
          <button onClick={addManual}
            className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-2xl text-sm font-medium hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-600 dark:hover:text-blue-400 transition-colors flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Question Manually
          </button>

          {/* Save / saved */}
          {savedMsg ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">{savedMsg}</p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">You can now import these in the Setup tab.</p>
              </div>
              <button onClick={onBack} className="text-sm font-medium text-green-700 dark:text-green-300 hover:underline">Go to Setup</button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => setStep(1)}
                className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
                ← Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving || questions.length === 0}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {saving ? 'Saving…' : `Save ${questions.length} Question${questions.length !== 1 ? 's' : ''} to Bank`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
