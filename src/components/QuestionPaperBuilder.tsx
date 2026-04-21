import { useState, useEffect, useRef } from 'react';
import { loadChapters, type BankChapter, type BankQuestion } from '../services/questionBank';
import { useExam } from '../context/ExamContext';
import type { SubPart } from '../types';
import { SubPartsEditor } from './SubPartsEditor';
import { geminiUrl } from '../services/geminiModel';

// ── Constants ─────────────────────────────────────────────────────────────────

const CLASS_OPTIONS = [
  { group: 'School Classes', options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
  { group: 'University Semesters', options: Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaperQuestion {
  id: string;
  question: string;
  marks: number;
  source: 'bank' | 'generated' | 'manual';
  bankRef?: { chapterId: string; questionId: string };
  subparts?: SubPart[];
  diagram?: string;
}

interface Meta {
  term: string;
  examClass: string;
  subject: string;
}

// ── Gemini helpers ─────────────────────────────────────────────────────────────

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

async function generateQuestionFromImage(file: File, marks: number, key: string): Promise<string> {
  if (!key) throw new Error('No AI API key. Enter your key in Setup → Advanced Settings.');
  const base64 = await toBase64(file);
  const marksHint =
    marks <= 2 ? 'a short recall or definition question (1–2 sentences answer)'
    : marks <= 5 ? 'an explanation or analysis question (3–5 sentence answer)'
    : 'a detailed essay or multi-part question (paragraph-length answer)';

  const raw = await callGemini(key, {
    contents: [{ parts: [
      { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
      { text: `You are an expert teacher. Read the textbook paragraph in this image and generate exactly ONE exam question worth ${marks} mark${marks !== 1 ? 's' : ''}.
The question should require ${marksHint}.
Return ONLY the question text — no numbering, no answer, no explanation.` },
    ]}],
    generationConfig: { temperature: 0.4, maxOutputTokens: 256 },
  });
  return raw.replace(/^["']|["']$/g, '').trim();
}

// ── Step 1: Meta form ─────────────────────────────────────────────────────────

function MetaForm({ onSubmit }: { onSubmit: (m: Meta) => void }) {
  const [term, setTerm] = useState('');
  const [examClass, setExamClass] = useState('');
  const [subject, setSubject] = useState('');

  const canSubmit = term.trim() && examClass && subject.trim();

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-zinc-100 mb-1 tracking-tight">New Question Paper</h2>
      <p className="text-sm text-slate-500 dark:text-zinc-400 mb-8">Fill in the exam details to get started.</p>

      <div className="space-y-5">
        {/* Term */}
        <div>
          <label className="block text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Exam Term</label>
          <input
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="e.g. Term 1, Mid-Term, Annual 2025"
            className="w-full px-4 py-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-purple-700 focus:border-transparent outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-zinc-700 text-slate-900 dark:text-zinc-100"
          />
        </div>

        {/* Class */}
        <div>
          <label className="block text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Class / Level</label>
          <select
            value={examClass}
            onChange={e => setExamClass(e.target.value)}
            className="w-full px-4 py-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-purple-700 focus:border-transparent outline-none transition-all text-slate-900 dark:text-zinc-100"
          >
            <option value="">Select class or semester…</option>
            {CLASS_OPTIONS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Mathematics, Physics, History"
            className="w-full px-4 py-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-purple-700 focus:border-transparent outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-zinc-700 text-slate-900 dark:text-zinc-100"
          />
        </div>

        <button
          onClick={() => canSubmit && onSubmit({ term: term.trim(), examClass, subject: subject.trim() })}
          disabled={!canSubmit}
          className="w-full bg-purple-700 hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[11px] uppercase tracking-widest py-3.5 rounded-xl transition-all active:scale-95 shadow-lg shadow-purple-500/20"
        >
          Build Question Paper →
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Paper builder ─────────────────────────────────────────────────────

type AddTab = 'bank' | 'photo' | 'manual';

function PaperBuilder({
  meta, userId, onBack,
}: {
  meta: Meta;
  userId: string;
  onBack: () => void;
}) {
  const { geminiApiKey } = useExam();
  const apiKey = resolveKey(geminiApiKey);

  const [paperQuestions, setPaperQuestions] = useState<PaperQuestion[]>([]);
  const [chapters, setChapters] = useState<BankChapter[]>([]);
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);

  // Add panel tabs
  const [addTab, setAddTab] = useState<AddTab>('bank');

  // Photo tab state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMarks, setPhotoMarks] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  // Manual tab state
  const [manualQ, setManualQ] = useState('');
  const [manualMarks, setManualMarks] = useState(5);

  // Random-N per chapter
  const [randomN, setRandomN] = useState<Record<string, number>>({});

  useEffect(() => {
    loadChapters(userId, undefined, meta.subject).then(setChapters);
  }, [userId, meta.subject]);

  // Revoke photoPreview object URL on unmount
  const photoPreviewRef = useRef(photoPreview);
  useEffect(() => { photoPreviewRef.current = photoPreview; }, [photoPreview]);
  useEffect(() => {
    return () => { if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current); };
  }, []);

  // ── Paper question helpers ─────────────────────────────────────────────────

  function addToPaper(q: PaperQuestion) {
    if (swapTargetId) {
      setPaperQuestions(prev => prev.map(p => p.id === swapTargetId ? { ...q, id: swapTargetId } : p));
      setSwapTargetId(null);
    } else {
      setPaperQuestions(prev => [...prev, q]);
    }
  }

  function removeFromPaper(id: string) {
    setPaperQuestions(prev => prev.filter(p => p.id !== id));
    if (swapTargetId === id) setSwapTargetId(null);
  }

  function updatePaperMarks(id: string, marks: number) {
    setPaperQuestions(prev => prev.map(p => p.id === id ? { ...p, marks } : p));
  }

  function movePaperQuestion(id: string, direction: -1 | 1) {
    setPaperQuestions(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + direction;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function addBankQuestion(ch: BankChapter, bq: BankQuestion) {
    addToPaper({
      id: crypto.randomUUID(),
      question: bq.question,
      marks: bq.marks,
      source: 'bank',
      bankRef: { chapterId: ch.id, questionId: bq.id },
      subparts: bq.subparts,
      diagram: bq.diagram,
    });
  }

  function updatePaperSubparts(id: string, subparts: SubPart[]) {
    setPaperQuestions(prev => prev.map(p => p.id === id ? { ...p, subparts } : p));
  }

  function updatePaperDiagram(id: string, diagram: string | undefined) {
    setPaperQuestions(prev => prev.map(p => p.id === id ? { ...p, diagram } : p));
  }

  function addRandomFromChapter(ch: BankChapter) {
    const n = randomN[ch.id] ?? 1;
    const alreadyIds = new Set(
      paperQuestions.filter(p => p.bankRef?.chapterId === ch.id).map(p => p.bankRef!.questionId)
    );
    const pool = ch.questions.filter(q => !alreadyIds.has(q.id));
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
    const toAdd: PaperQuestion[] = shuffled.map(bq => ({
      id: crypto.randomUUID(),
      question: bq.question,
      marks: bq.marks,
      source: 'bank',
      bankRef: { chapterId: ch.id, questionId: bq.id },
    }));
    if (swapTargetId && toAdd.length === 1) {
      addToPaper(toAdd[0]);
    } else {
      setPaperQuestions(prev => [...prev, ...toAdd]);
    }
  }

  // ── Photo generation ───────────────────────────────────────────────────────

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    setPhotoFile(file);
    setGenError('');
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleGenerate() {
    if (!photoFile) return;
    if (!apiKey) { setGenError('No AI API key. Enter it in Setup → Advanced Settings.'); return; }
    setGenerating(true);
    setGenError('');
    try {
      const q = await generateQuestionFromImage(photoFile, photoMarks, apiKey);
      addToPaper({ id: crypto.randomUUID(), question: q, marks: photoMarks, source: 'generated' });
      setPhotoFile(null);
      setPhotoPreview(null);
      if (photoRef.current) photoRef.current.value = '';
    } catch (e) {
      setGenError((e as Error).message);
    }
    setGenerating(false);
  }

  // ── Manual add ─────────────────────────────────────────────────────────────

  function handleAddManual() {
    if (!manualQ.trim()) return;
    addToPaper({ id: crypto.randomUUID(), question: manualQ.trim(), marks: manualMarks, source: 'manual' });
    setManualQ('');
    setManualMarks(5);
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  function handlePrint() {
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = paperQuestions.map((pq, i) => {
      const subpartsHtml = pq.subparts?.length
        ? `<ol type="a" style="margin:8px 0 0 0;padding-left:20px;line-height:1.8;">${pq.subparts.map(sp => `<li>${sp.question || '&nbsp;'}</li>`).join('')}</ol>`
        : '';
      const diagramHtml = pq.diagram
        ? `<div style="margin-top:8px;"><img src="${pq.diagram}" style="max-width:240px;max-height:180px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px;" /></div>`
        : '';
      return `
      <tr>
        <td style="padding:10px 8px;vertical-align:top;font-weight:600;color:#555;white-space:nowrap;">Q${i + 1}.</td>
        <td style="padding:10px 8px;vertical-align:top;line-height:1.6;">${pq.question}${diagramHtml}${subpartsHtml}</td>
        <td style="padding:10px 8px;vertical-align:top;text-align:right;white-space:nowrap;font-weight:700;color:#333;">[${pq.marks} mark${pq.marks !== 1 ? 's' : ''}]</td>
      </tr>
    `;
    }).join('');
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>${meta.subject} — Question Paper</title>
  <style>
    body { font-family: Georgia, serif; margin: 0; padding: 40px; color: #111; }
    h1 { font-size: 22px; margin: 0 0 4px; text-align: center; }
    .meta { text-align: center; font-size: 13px; color: #666; margin-bottom: 24px; }
    hr { border: none; border-top: 1px solid #ccc; margin-bottom: 28px; }
    table { width: 100%; border-collapse: collapse; }
    tr + tr td { border-top: 1px solid #eee; }
    .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #aaa; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  <h1>${meta.subject} — Question Paper</h1>
  <p class="meta">${meta.examClass} &nbsp;·&nbsp; ${meta.term} &nbsp;·&nbsp; Total Marks: ${totalMarks}</p>
  <hr/>
  <table>${rows}</table>
  <p class="footer">Generated by Exam Checker</p>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`);
    win.document.close();
  }

  const totalMarks = paperQuestions.reduce((s, q) => s + q.marks, 0);

  // ── Shared styles ──────────────────────────────────────────────────────────

  const inputCls = 'w-full px-3 py-2.5 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-purple-700 focus:border-transparent outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-zinc-700 text-slate-900 dark:text-zinc-100';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div>
            <span className="text-base font-bold text-slate-900 dark:text-zinc-100">{meta.subject}</span>
            <span className="text-xs text-slate-400 dark:text-zinc-500 ml-2">{meta.examClass} · {meta.term}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-zinc-300">
            {paperQuestions.length} question{paperQuestions.length !== 1 ? 's' : ''} · <span className="text-purple-700 dark:text-purple-400">{totalMarks} marks</span>
          </span>
          <button
            onClick={handlePrint}
            disabled={paperQuestions.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-700 hover:bg-purple-800 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-purple-500/20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / Export
          </button>
        </div>
      </div>

      {swapTargetId && (
        <div className="mb-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl flex items-center justify-between">
          <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
            Swap mode — click any question in the bank to replace the selected question.
          </span>
          <button onClick={() => setSwapTargetId(null)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline ml-4 shrink-0">Cancel</button>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start flex-1">

        {/* ── LEFT: Paper + Add panel ────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Paper questions list */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">Question Paper</h3>
              {paperQuestions.length > 0 && (
                <span className="text-xs text-slate-400 dark:text-zinc-500">{totalMarks} total marks</span>
              )}
            </div>

            {paperQuestions.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-slate-400 dark:text-zinc-500">No questions added yet.</p>
                <p className="text-xs text-slate-300 dark:text-zinc-600 mt-1">Select from the bank, generate from a photo, or type manually.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                {paperQuestions.map((pq, idx) => (
                  <div key={pq.id} className={`px-4 py-3 transition-colors ${swapTargetId === pq.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                    <div className="flex gap-3 items-start">
                    {/* Number */}
                    <span className="text-xs font-bold text-slate-400 dark:text-zinc-500 w-5 shrink-0 pt-0.5">Q{idx + 1}</span>

                    {/* Question text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 dark:text-zinc-200 leading-snug">{pq.question}</p>
                      <SubPartsEditor
                        subparts={pq.subparts ?? []}
                        diagram={pq.diagram}
                        onSubpartsChange={sp => updatePaperSubparts(pq.id, sp)}
                        onDiagramChange={d => updatePaperDiagram(pq.id, d)}
                      />
                    </div>

                    {/* Marks + controls */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={pq.marks}
                          onChange={e => updatePaperMarks(pq.id, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-12 text-center px-1 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-xs font-bold border border-purple-200 dark:border-purple-800 focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <span className="text-xs text-purple-600 dark:text-purple-400 font-bold">m</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          onClick={() => movePaperQuestion(pq.id, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 disabled:opacity-30"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                        </button>
                        <button
                          onClick={() => movePaperQuestion(pq.id, 1)}
                          disabled={idx === paperQuestions.length - 1}
                          title="Move down"
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 disabled:opacity-30"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        <button
                          onClick={() => setSwapTargetId(swapTargetId === pq.id ? null : pq.id)}
                          title="Swap this question"
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${swapTargetId === pq.id ? 'text-amber-500' : 'text-slate-400 dark:text-zinc-500 hover:text-amber-500'}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => removeFromPaper(pq.id)}
                          title="Remove"
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-zinc-500 hover:text-red-500"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    </div>{/* end flex gap-3 items-start */}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add question panel */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="flex border-b border-slate-100 dark:border-zinc-800">
              {([['bank', 'From Bank'], ['photo', 'From Photo'], ['manual', 'Type Manually']] as [AddTab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setAddTab(id)}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${addTab === id ? 'text-purple-700 dark:text-purple-400 border-b-2 border-purple-700 dark:border-purple-400' : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {/* Tab: From Bank */}
              {addTab === 'bank' && (
                <div className="text-center py-6">
                  <svg className="w-8 h-8 text-slate-300 dark:text-zinc-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-sm text-slate-500 dark:text-zinc-400">Browse the question bank on the right.</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">Click <strong>Add</strong> on any question, or use <strong>Add N random</strong> per chapter.</p>
                  {swapTargetId && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">Swap mode active — click a bank question to replace the highlighted paper question.</p>
                  )}
                </div>
              )}

              {/* Tab: From Photo */}
              {addTab === 'photo' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-zinc-400">Upload a photo of a textbook paragraph. AI will extract the text and generate a question proportional to the marks you set.</p>

                  {/* Marks input */}
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest shrink-0">Marks</label>
                    <input
                      type="number"
                      min={1} max={20}
                      value={photoMarks}
                      onChange={e => setPhotoMarks(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-3 py-2 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-purple-700 focus:border-transparent outline-none text-slate-900 dark:text-zinc-100"
                    />
                  </div>

                  {/* Photo upload */}
                  {photoPreview ? (
                    <div className="relative">
                      <img src={photoPreview} alt="Paragraph preview" className="w-full max-h-40 object-contain rounded-xl border border-slate-200 dark:border-zinc-700" />
                      <button
                        onClick={() => { setPhotoFile(null); setPhotoPreview(null); if (photoRef.current) photoRef.current.value = ''; }}
                        className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => photoRef.current?.click()}
                      className="w-full py-6 border-2 border-dashed border-slate-200 dark:border-zinc-700 rounded-xl flex flex-col items-center gap-2 text-slate-400 dark:text-zinc-500 hover:border-purple-400 hover:text-purple-600 transition-colors"
                    >
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs font-medium">Click to upload textbook paragraph photo</span>
                    </button>
                  )}
                  <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />

                  {genError && (
                    <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{genError}</p>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={!photoFile || generating}
                    className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-40 text-white font-bold text-[11px] uppercase tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    {generating ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                        Generating…
                      </>
                    ) : 'Generate Question'}
                  </button>
                </div>
              )}

              {/* Tab: Manual */}
              {addTab === 'manual' && (
                <div className="space-y-3">
                  <textarea
                    value={manualQ}
                    onChange={e => setManualQ(e.target.value)}
                    placeholder="Type your question here…"
                    rows={4}
                    className={`${inputCls} resize-none`}
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest shrink-0">Marks</label>
                    <input
                      type="number"
                      min={1} max={20}
                      value={manualMarks}
                      onChange={e => setManualMarks(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-3 py-2 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-purple-700 focus:border-transparent outline-none text-slate-900 dark:text-zinc-100"
                    />
                  </div>
                  <button
                    onClick={handleAddManual}
                    disabled={!manualQ.trim()}
                    className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-40 text-white font-bold text-[11px] uppercase tracking-widest rounded-xl transition-all active:scale-95"
                  >
                    Add to Paper
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Question bank browser ──────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">
              {meta.subject} — Question Bank
            </h3>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
              {chapters.length === 0 ? 'No chapters uploaded for this subject yet.' : `${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {chapters.length === 0 ? (
            <div className="py-16 text-center px-6">
              <svg className="w-8 h-8 text-slate-300 dark:text-zinc-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-slate-400 dark:text-zinc-500">No questions uploaded for <strong>{meta.subject}</strong> yet.</p>
              <p className="text-xs text-slate-300 dark:text-zinc-600 mt-1">Use "Upload Questions" to add chapters first.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-zinc-800 max-h-[70vh] overflow-y-auto">
              {chapters.map(ch => {
                const isOpen = openChapters.has(ch.id);
                const addedIds = new Set(
                  paperQuestions.filter(p => p.bankRef?.chapterId === ch.id).map(p => p.bankRef!.questionId)
                );
                const available = ch.questions.filter(q => !addedIds.has(q.id)).length;

                return (
                  <div key={ch.id}>
                    {/* Chapter header */}
                    <div className="flex items-center gap-2 px-4 py-3">
                      <button
                        onClick={() => setOpenChapters(prev => {
                          const next = new Set(prev);
                          next.has(ch.id) ? next.delete(ch.id) : next.add(ch.id);
                          return next;
                        })}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                          <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="text-sm font-semibold text-slate-700 dark:text-zinc-300">{ch.chapter}</span>
                        <span className="text-xs text-slate-400 dark:text-zinc-500">{ch.questions.length}q</span>
                      </button>

                      {/* Add N random */}
                      {available > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={available}
                            value={randomN[ch.id] ?? 1}
                            onChange={e => setRandomN(prev => ({ ...prev, [ch.id]: Math.max(1, Math.min(available, parseInt(e.target.value) || 1)) }))}
                            className="w-10 text-center px-1 py-1 text-xs border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 focus:ring-1 focus:ring-purple-700 outline-none"
                          />
                          <button
                            onClick={() => addRandomFromChapter(ch)}
                            className="px-2 py-1 text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                          >
                            Add random
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Questions */}
                    {isOpen && (
                      <div className="pb-2">
                        {ch.questions.map(bq => {
                          const isAdded = addedIds.has(bq.id);
                          const isSwapMode = !!swapTargetId;
                          return (
                            <div
                              key={bq.id}
                              className={`flex items-start gap-3 px-4 py-2.5 mx-2 mb-1 rounded-xl transition-colors ${
                                isAdded && !isSwapMode
                                  ? 'bg-slate-50 dark:bg-zinc-800/40 opacity-50'
                                  : isSwapMode
                                  ? 'hover:bg-purple-50 dark:hover:bg-purple-900/20 cursor-pointer'
                                  : 'hover:bg-slate-50 dark:hover:bg-zinc-800/40 cursor-pointer'
                              }`}
                              onClick={() => !isAdded || isSwapMode ? addBankQuestion(ch, bq) : undefined}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-700 dark:text-zinc-300 leading-snug">{bq.question}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs font-bold text-slate-400 dark:text-zinc-500">{bq.marks}m</span>
                                {isAdded && !isSwapMode ? (
                                  <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                ) : (
                                  <button
                                    onClick={e => { e.stopPropagation(); addBankQuestion(ch, bq); }}
                                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold transition-colors ${isSwapMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-purple-700 hover:bg-purple-800'}`}
                                  >
                                    {isSwapMode ? '⇄' : '+'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function QuestionPaperBuilder({ userId = '' }: { userId?: string; onBack: () => void }) {
  const [step, setStep] = useState<'meta' | 'build'>('meta');
  const [meta, setMeta] = useState<Meta | null>(null);

  if (step === 'meta' || !meta) {
    return (
      <MetaForm
        onSubmit={m => { setMeta(m); setStep('build'); }}
      />
    );
  }

  return (
    <PaperBuilder
      meta={meta}
      userId={userId}
      onBack={() => setStep('meta')}
    />
  );
}
