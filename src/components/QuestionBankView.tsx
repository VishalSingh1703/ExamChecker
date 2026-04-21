import { useState, useRef } from 'react';
import { saveChapter, type BankQuestion } from '../services/questionBank';
import { useExam } from '../context/ExamContext';
import type { SubPart } from '../types';
import { SubPartsEditor } from './SubPartsEditor';
import { geminiUrl } from '../services/geminiModel';

// ── Class options (same as ExamSetup) ────────────────────────────────────────

const CLASS_OPTIONS = [
  { group: 'School Classes', options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
  { group: 'University Semesters', options: Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) },
];

// ── Gemini helpers ────────────────────────────────────────────────────────────

// Key resolution: context key (user-entered) → env var → empty
function resolveKey(contextKey: string): string {
  if (contextKey?.trim()) return contextKey.trim();
  return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ?? '';
}

async function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result !== 'string') { rej(new Error('FileReader result is not a string')); return; }
      const idx = r.result.indexOf(',');
      if (idx === -1) { rej(new Error('FileReader result missing base64 separator')); return; }
      res(r.result.slice(idx + 1));
    };
    r.onerror = () => rej(r.error ?? new Error('FileReader error'));
    r.readAsDataURL(file);
  });
}

const EXTRACT_PROMPT = `Extract every exam or textbook question from the content.
For each question identify if it has sub-parts labeled with letters (a, b, c…) or roman numerals (i, ii, iii…).

Return a JSON array where each element has:
- "question": the main question text (strip leading numbers like "1.", "Q1.", "Q1)")
- "subparts": array of sub-part texts in order (strip their labels like "a.", "(a)", "i." etc.), empty array if none

Example:
[
  {"question": "Define osmosis.", "subparts": []},
  {"question": "Explain the digestive system.", "subparts": ["Describe the role of the stomach.", "What is the function of the small intestine?"]}
]

Return ONLY the JSON array — no other text, no markdown, no code fences.`;

interface ExtractedQuestion {
  question: string;
  subparts: string[];
}

function parseStructuredQuestions(raw: string): ExtractedQuestion[] {
  function toExtracted(arr: unknown[]): ExtractedQuestion[] {
    return arr.map(item => {
      if (typeof item === 'string') return { question: item.trim(), subparts: [] };
      const obj = item as Record<string, unknown>;
      return {
        question: String(obj.question ?? '').trim(),
        subparts: Array.isArray(obj.subparts)
          ? (obj.subparts as unknown[]).map(s => String(s).trim()).filter(Boolean)
          : [],
      };
    }).filter(q => q.question.length > 0);
  }
  // 1. Direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return toExtracted(parsed);
  } catch { /* fall through */ }
  // 2. Extract first [...] block
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return toExtracted(parsed);
    } catch { /* fall through */ }
  }
  // 3. Plain lines fallback — no subparts
  const lines = raw
    .split('\n')
    .map(l => l.replace(/^\s*(?:\d+[\.\)]\s*|Q\d+[\.\):\s]+)/i, '').trim())
    .filter(l => l.length > 4);
  if (lines.length > 0) return lines.map(q => ({ question: q, subparts: [] }));
  throw new Error('Could not extract questions. Try a clearer file or add questions manually.');
}

async function callGemini(key: string, body: object): Promise<string> {
  const res = await fetch(
    geminiUrl(key),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `AI error ${res.status}`);
  }
  const data = await res.json();
  return ((data.candidates?.[0]?.content?.parts ?? []) as { text?: string }[])
    .map(p => p.text ?? '').join('').trim();
}

async function extractQuestionsFromImage(file: File, key: string): Promise<ExtractedQuestion[]> {
  if (!key) throw new Error('No AI API key. Enter your key in Setup → Advanced Settings.');
  const base64 = await toBase64(file);
  const raw = await callGemini(key, {
    contents: [{ parts: [
      { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
      { text: EXTRACT_PROMPT },
    ]}],
    generationConfig: { temperature: 0, maxOutputTokens: 4096 },
  });
  return parseStructuredQuestions(raw);
}

async function extractQuestionsFromPdf(file: File, key: string): Promise<ExtractedQuestion[]> {
  if (!key) throw new Error('No AI API key. Enter your key in Setup → Advanced Settings.');
  const base64 = await toBase64(file);
  const raw = await callGemini(key, {
    contents: [{ parts: [
      { inlineData: { mimeType: 'application/pdf', data: base64 } },
      { text: EXTRACT_PROMPT },
    ]}],
    generationConfig: { temperature: 0, maxOutputTokens: 4096 },
  });
  return parseStructuredQuestions(raw);
}

async function extractQuestionsFromTxt(file: File, key: string): Promise<ExtractedQuestion[]> {
  if (!key) throw new Error('No AI API key. Enter your key in Setup → Advanced Settings.');
  const text = await file.text();
  const raw = await callGemini(key, {
    contents: [{ parts: [{ text: `${EXTRACT_PROMPT}\n\n---\n${text.slice(0, 8000)}\n---` }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096 },
  });
  return parseStructuredQuestions(raw);
}

async function geminiGenerateAnswer(question: string, cls: string, marks: number, key: string): Promise<string> {
  if (!key) throw new Error('No AI API key. Enter your key in Setup → Advanced Settings.');
  const prompt = `You are an expert teacher. Write an ideal model answer for the following exam question.

Question: "${question}"
Class/Level: ${cls}
Marks allocated: ${marks}

Guidelines:
- For 1–2 marks: 1–2 short sentences, simple vocabulary
- For 3–5 marks: 3–5 sentences with key terms
- For 6+ marks: detailed paragraphs with examples
Write ONLY the answer text. No labels, no formatting markers.`;
  return callGemini(key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
  });
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
  subparts: SubPart[];
  diagram?: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export function QuestionBankView({ userId = '', onBack }: { userId?: string; onBack: () => void }) {
  const { geminiApiKey } = useExam();
  const apiKey = resolveKey(geminiApiKey);

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
  const [shorteningId, setShorteningId] = useState<string | null>(null);
  const [definingId, setDefiningId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function addManual() {
    setQuestions(prev => [...prev, { id: crypto.randomUUID(), question: '', expectedAnswer: '', marks: 5, subparts: [] }]);
  }

  function updateQ(id: string, field: keyof Pick<EditableQ, 'question' | 'expectedAnswer' | 'marks'>, value: string | number) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  }

  function updateQSubparts(id: string, subparts: SubPart[]) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, subparts } : q));
  }

  function updateQDiagram(id: string, diagram: string | undefined) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, diagram } : q));
  }

  function removeQ(id: string) {
    setQuestions(prev => prev.filter(q => q.id !== id));
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Auto-set chapter name from the first file's name (strip extension)
    if (!chapter.trim() && files[0]) {
      setChapter(files[0].name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim());
    }
    setExtracting(true);
    setExtractError('');
    try {
      const extracted: ExtractedQuestion[] = [];
      for (const file of Array.from(files)) {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
        if (isPdf) extracted.push(...await extractQuestionsFromPdf(file, apiKey));
        else if (isTxt) extracted.push(...await extractQuestionsFromTxt(file, apiKey));
        else extracted.push(...await extractQuestionsFromImage(file, apiKey));
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
    setGeneratingId(id);
    setGenErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const answer = await geminiGenerateAnswer(q.question, cls, q.marks, apiKey);
      updateQ(id, 'expectedAnswer', answer);
    } catch (err) {
      setGenErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed.' }));
    } finally {
      setGeneratingId(null);
    }
  }

  async function processAnswerBank(id: string, mode: 'shorten' | 'define') {
    const q = questions.find(x => x.id === id);
    if (!q?.expectedAnswer.trim()) return;
    if (!apiKey) { return; }
    if (mode === 'shorten') setShorteningId(id); else setDefiningId(id);
    setGenErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    const prompt = mode === 'shorten'
      ? `You are an expert teacher. Shorten the following answer to be more concise while keeping every key point.

Question: "${q.question}"
Class/Level: ${cls}
Marks allocated: ${q.marks}
Current answer: "${q.expectedAnswer}"

Remove repetition and filler. Preserve all essential facts and key terms.
Write ONLY the shortened answer. No labels, no formatting markers.`
      : `You are an expert teacher. Expand and enrich the following answer with definitions, examples, and detail.

Question: "${q.question}"
Class/Level: ${cls}
Marks allocated: ${q.marks}
Current answer: "${q.expectedAnswer}"

Add relevant explanations and technical vocabulary for ${cls}. Scale depth to ${q.marks} mark${q.marks !== 1 ? 's' : ''}.
Write ONLY the expanded answer. No labels, no formatting markers.`;
    try {
      const answer = await callGemini(apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
      });
      updateQ(id, 'expectedAnswer', answer);
    } catch (err) {
      setGenErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed.' }));
    } finally {
      if (mode === 'shorten') setShorteningId(null); else setDefiningId(null);
    }
  }

  async function generateAllBankAnswers() {
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
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">Upload Questions</h2>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">Select the class and subject. You can name the chapter on the next step.</p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Class</label>
            <select
              value={cls} onChange={e => setCls(e.target.value)}
              className="w-full border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-950 text-slate-800 dark:text-zinc-200"
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
            <label className="block text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Subject</label>
            <input
              type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Biology, Mathematics, History"
              className="w-full border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-950 text-slate-800 dark:text-zinc-200 placeholder:text-slate-300 dark:placeholder:text-zinc-700"
            />
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!cls || !subject.trim()}
            className="w-full py-3 bg-purple-700 text-white rounded-xl font-bold text-[11px] uppercase tracking-widest hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 active:scale-95 transition-all"
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

          {/* Upload strip */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <input ref={photoRef} type="file" accept="image/*,.pdf,.txt" multiple className="hidden"
              onChange={e => handleFileUpload(e.target.files)} />
            <div className="flex items-center gap-3 flex-wrap">
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
                {extracting ? 'Extracting…' : 'Upload Questions'}
              </button>
              <div className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                AI will extract all questions automatically
                <span className="block text-gray-300 dark:text-gray-600">Photo · PDF · .txt file</span>
              </div>
            </div>
            {extractError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{extractError}</p>}
          </div>

          {/* Generate All — top */}
          {questions.length > 0 && (() => {
            const missing = questions.filter(q => q.question.trim() && !q.expectedAnswer.trim()).length;
            return (
              <button onClick={generateAllBankAnswers}
                disabled={generatingAll || generatingId !== null || shorteningId !== null || definingId !== null || missing === 0}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {generatingAll
                  ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Generating all answers…</>
                  : `Generate All Answers${missing > 0 ? ` (${missing} missing)` : ''}`}
              </button>
            );
          })()}

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
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                    <SubPartsEditor
                      subparts={q.subparts}
                      diagram={q.diagram}
                      onSubpartsChange={sp => updateQSubparts(q.id, sp)}
                      onDiagramChange={d => updateQDiagram(q.id, d)}
                    />
                  </div>

                  {/* Marks + Generate */}
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Marks</label>
                      <input
                        type="text" inputMode="numeric" pattern="[0-9]*"
                        value={q.marks === 0 ? '' : String(q.marks)}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^0-9]/g, '');
                          updateQ(q.id, 'marks', raw === '' ? 0 : parseInt(raw, 10));
                        }}
                        placeholder="1–20"
                        className={`w-20 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 ${
                          q.marks === 0 || q.marks > 20
                            ? 'border-red-400 dark:border-red-600'
                            : 'border-gray-300 dark:border-gray-700'
                        }`}
                      />
                      {q.marks === 0 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Required.</p>}
                      {q.marks > 20 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Max 20.</p>}
                    </div>
                    {/* − Shorten | Generate | + Define */}
                    <div className="flex items-center gap-1">
                      <button onClick={() => processAnswerBank(q.id, 'shorten')}
                        disabled={shorteningId !== null || definingId !== null || generatingId !== null || generatingAll || !q.expectedAnswer.trim()}
                        className="flex items-center gap-1 px-2 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        {shorteningId === q.id ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> : '−'}
                        {shorteningId === q.id ? 'Shortening…' : 'Shorten'}
                      </button>
                      <button onClick={() => handleGenerate(q.id)}
                        disabled={!q.question.trim() || generatingId !== null || shorteningId !== null || definingId !== null || generatingAll}
                        className="flex items-center gap-1.5 px-2 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 text-xs font-medium hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {generatingId === q.id ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Generating…</> : <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>Generate</>}
                      </button>
                      <button onClick={() => processAnswerBank(q.id, 'define')}
                        disabled={shorteningId !== null || definingId !== null || generatingId !== null || generatingAll || !q.expectedAnswer.trim()}
                        className="flex items-center gap-1 px-2 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        {definingId === q.id ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> : '+'}
                        {definingId === q.id ? 'Defining…' : 'Define'}
                      </button>
                    </div>
                  </div>

                  {/* Expected answer */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Expected Answer</label>
                    <textarea
                      value={q.expectedAnswer} onChange={e => updateQ(q.id, 'expectedAnswer', e.target.value)}
                      rows={3} placeholder="Enter or generate the expected answer…"
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                    {genErrors[q.id] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{genErrors[q.id]}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Generate All — bottom */}
          {questions.length > 0 && (() => {
            const missing = questions.filter(q => q.question.trim() && !q.expectedAnswer.trim()).length;
            return (
              <button onClick={generateAllBankAnswers}
                disabled={generatingAll || generatingId !== null || shorteningId !== null || definingId !== null || missing === 0}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {generatingAll
                  ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Generating all answers…</>
                  : `Generate All Answers${missing > 0 ? ` (${missing} missing)` : ''}`}
              </button>
            );
          })()}

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
                disabled={saving || questions.length === 0 || questions.some(q => q.marks === 0 || q.marks > 20)}
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
