import { useState, useEffect, useRef } from 'react';
import { loadChapters, type BankChapter, type BankQuestion } from '../../services/data/questionBank';
import { useExam } from '../../context/ExamContext';
import type { SubPart } from '../../types';
import { resolveGeminiKey } from '../../config/env';
import { CLASS_OPTIONS } from '../../config/constants';
import { generateQuestionFromImage } from '../../services/ai/authoring';
import { SubPartsEditor } from '../setup/SubPartsEditor';
import { Alert, Button, Card, Caret, Icon, Select, TextArea, TextInput } from '../../components/ui';

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

// ── Step 1: Meta form ─────────────────────────────────────────────────────────

function MetaForm({ onSubmit }: { onSubmit: (m: Meta) => void }) {
  const [term, setTerm] = useState('');
  const [examClass, setExamClass] = useState('');
  const [subject, setSubject] = useState('');

  const canSubmit = term.trim() && examClass && subject.trim();

  return (
    <div className="max-w-md mx-auto py-12 px-4 animate-fade-in">
      <h2 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-100 mb-1 tracking-tight">New Question Paper</h2>
      <p className="text-sm text-ink-500 dark:text-ink-400 mb-8">Fill in the exam details to get started.</p>

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-1.5">Exam Term</label>
          <TextInput
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="e.g. Term 1, Mid-Term, Annual 2025"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-1.5">Class / Level</label>
          <Select value={examClass} onChange={e => setExamClass(e.target.value)}>
            <option value="">Select class or semester…</option>
            {CLASS_OPTIONS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-1.5">Subject</label>
          <TextInput
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Mathematics, Physics, History"
          />
        </div>

        <Button
          className="w-full py-3"
          onClick={() => canSubmit && onSubmit({ term: term.trim(), examClass, subject: subject.trim() })}
          disabled={!canSubmit}
        >
          Build Question Paper →
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: Builder ───────────────────────────────────────────────────────────

type AddTab = 'bank' | 'photo' | 'manual';

function PaperBuilder({ meta, userId, onBack }: { meta: Meta; userId: string; onBack: () => void }) {
  const { geminiApiKey } = useExam();
  const apiKey = resolveGeminiKey(geminiApiKey);

  const [paperQuestions, setPaperQuestions] = useState<PaperQuestion[]>([]);
  const [chapters, setChapters] = useState<BankChapter[]>([]);
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);

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

  // ── Paper question helpers ──────────────────────────────────────────────────

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

  function updatePaper(id: string, patch: Partial<PaperQuestion>) {
    setPaperQuestions(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
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

  function addRandomFromChapter(ch: BankChapter) {
    const n = randomN[ch.id] ?? 1;
    const alreadyIds = new Set(
      paperQuestions.filter(p => p.bankRef?.chapterId === ch.id).map(p => p.bankRef!.questionId),
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

  // ── Photo generation ────────────────────────────────────────────────────────

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
    setGenerating(true);
    setGenError('');
    try {
      const q = await generateQuestionFromImage(photoFile, photoMarks, apiKey);
      addToPaper({ id: crypto.randomUUID(), question: q, marks: photoMarks, source: 'generated' });
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFile(null);
      setPhotoPreview(null);
      if (photoRef.current) photoRef.current.value = '';
    } catch (e) {
      setGenError((e as Error).message);
    }
    setGenerating(false);
  }

  function handleAddManual() {
    if (!manualQ.trim()) return;
    addToPaper({ id: crypto.randomUUID(), question: manualQ.trim(), marks: manualMarks, source: 'manual' });
    setManualQ('');
    setManualMarks(5);
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  const totalMarks = paperQuestions.reduce((s, q) => s + q.marks, 0);

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
  <p class="footer">Generated by ExamChecker</p>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`);
    win.document.close();
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-200"
          >
            <Icon name="chevronLeft" className="w-4 h-4" />
            Back
          </button>
          <div>
            <span className="text-base font-bold text-ink-900 dark:text-ink-100">{meta.subject}</span>
            <span className="text-xs text-ink-400 dark:text-ink-500 ml-2">{meta.examClass} · {meta.term}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-700 dark:text-ink-300">
            {paperQuestions.length} question{paperQuestions.length !== 1 ? 's' : ''} · <span className="text-accent-700 dark:text-accent-400">{totalMarks} marks</span>
          </span>
          <Button icon="print" onClick={handlePrint} disabled={paperQuestions.length === 0}>
            Print / Export
          </Button>
        </div>
      </div>

      {swapTargetId && (
        <Alert tone="warning" className="mb-3">
          <div className="flex items-center justify-between gap-4 w-full">
            <span className="font-medium">Swap mode — click any question in the bank to replace the selected question.</span>
            <button onClick={() => setSwapTargetId(null)} className="text-xs hover:underline shrink-0">Cancel</button>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start flex-1">
        {/* ── LEFT: Paper + Add panel ───────────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">Question Paper</h3>
              {paperQuestions.length > 0 && (
                <span className="text-xs text-ink-400 dark:text-ink-500">{totalMarks} total marks</span>
              )}
            </div>

            {paperQuestions.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-ink-400 dark:text-ink-500">No questions added yet.</p>
                <p className="text-xs text-ink-300 dark:text-ink-600 mt-1">Select from the bank, generate from a photo, or type manually.</p>
              </div>
            ) : (
              <div className="divide-y divide-ink-100 dark:divide-ink-800">
                {paperQuestions.map((pq, idx) => (
                  <div key={pq.id} className={`px-4 py-3 transition-colors ${swapTargetId === pq.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                    <div className="flex gap-3 items-start">
                      <span className="text-xs font-bold text-ink-400 dark:text-ink-500 w-6 shrink-0 pt-0.5">Q{idx + 1}</span>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-800 dark:text-ink-200 leading-snug">{pq.question}</p>
                        <SubPartsEditor
                          subparts={pq.subparts ?? []}
                          diagram={pq.diagram}
                          onSubpartsChange={sp => updatePaper(pq.id, { subparts: sp })}
                          onDiagramChange={d => updatePaper(pq.id, { diagram: d })}
                        />
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={pq.marks}
                            onChange={e => updatePaper(pq.id, { marks: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="w-12 text-center px-1 py-0.5 rounded-lg bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 text-xs font-bold border border-accent-200 dark:border-accent-800 focus:outline-none focus:ring-1 focus:ring-accent-500"
                          />
                          <span className="text-xs text-accent-600 dark:text-accent-400 font-bold">m</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <button
                            onClick={() => movePaperQuestion(pq.id, -1)}
                            disabled={idx === 0}
                            title="Move up"
                            className="w-5 h-5 flex items-center justify-center rounded text-ink-400 dark:text-ink-500 hover:text-ink-700 dark:hover:text-ink-300 disabled:opacity-30"
                          >
                            <Icon name="chevronUp" className="w-3 h-3" strokeWidth={2.5} />
                          </button>
                          <button
                            onClick={() => movePaperQuestion(pq.id, 1)}
                            disabled={idx === paperQuestions.length - 1}
                            title="Move down"
                            className="w-5 h-5 flex items-center justify-center rounded text-ink-400 dark:text-ink-500 hover:text-ink-700 dark:hover:text-ink-300 disabled:opacity-30"
                          >
                            <Icon name="chevronDown" className="w-3 h-3" strokeWidth={2.5} />
                          </button>
                          <button
                            onClick={() => setSwapTargetId(swapTargetId === pq.id ? null : pq.id)}
                            title="Swap this question"
                            className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${swapTargetId === pq.id ? 'text-amber-500' : 'text-ink-400 dark:text-ink-500 hover:text-amber-500'}`}
                          >
                            <Icon name="swap" className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeFromPaper(pq.id)}
                            title="Remove"
                            className="w-5 h-5 flex items-center justify-center rounded text-ink-400 dark:text-ink-500 hover:text-red-500"
                          >
                            <Icon name="x" className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Add question panel */}
          <Card className="overflow-hidden">
            <div className="flex border-b border-ink-100 dark:border-ink-800">
              {([['bank', 'From Bank'], ['photo', 'From Photo'], ['manual', 'Type Manually']] as [AddTab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setAddTab(id)}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${addTab === id ? 'text-accent-700 dark:text-accent-400 border-b-2 border-accent-700 dark:border-accent-400' : 'text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {addTab === 'bank' && (
                <div className="text-center py-6">
                  <Icon name="bank" className="w-8 h-8 text-ink-300 dark:text-ink-600 mx-auto mb-2" strokeWidth={1.5} />
                  <p className="text-sm text-ink-500 dark:text-ink-400">Browse the question bank on the right.</p>
                  <p className="text-xs text-ink-400 dark:text-ink-500 mt-1">Click <strong>Add</strong> on any question, or use <strong>Add N random</strong> per chapter.</p>
                  {swapTargetId && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">Swap mode active — click a bank question to replace the highlighted paper question.</p>
                  )}
                </div>
              )}

              {addTab === 'photo' && (
                <div className="space-y-3">
                  <p className="text-xs text-ink-500 dark:text-ink-400">Upload a photo of a textbook paragraph. AI will extract the text and generate a question proportional to the marks you set.</p>

                  <div className="flex items-center gap-3">
                    <label className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide shrink-0">Marks</label>
                    <input
                      type="number"
                      min={1} max={20}
                      value={photoMarks}
                      onChange={e => setPhotoMarks(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-3 py-2 bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 rounded-xl text-sm focus:ring-2 focus:ring-accent-600 focus:border-transparent outline-none text-ink-900 dark:text-ink-100"
                    />
                  </div>

                  {photoPreview ? (
                    <div className="relative">
                      <img src={photoPreview} alt="Paragraph preview" className="w-full max-h-40 object-contain rounded-xl border border-ink-200 dark:border-ink-700" />
                      <button
                        onClick={() => { if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoFile(null); setPhotoPreview(null); if (photoRef.current) photoRef.current.value = ''; }}
                        className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                        aria-label="Remove photo"
                      >
                        <Icon name="x" className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => photoRef.current?.click()}
                      className="w-full py-6 border-2 border-dashed border-ink-200 dark:border-ink-700 rounded-xl flex flex-col items-center gap-2 text-ink-400 dark:text-ink-500 hover:border-accent-400 hover:text-accent-600 transition-colors"
                    >
                      <Icon name="image" className="w-7 h-7" strokeWidth={1.5} />
                      <span className="text-xs font-medium">Click to upload textbook paragraph photo</span>
                    </button>
                  )}
                  <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />

                  {genError && <Alert tone="error" className="text-xs">{genError}</Alert>}

                  <Button className="w-full" onClick={handleGenerate} disabled={!photoFile} loading={generating} icon={generating ? undefined : 'sparkles'}>
                    {generating ? 'Generating…' : 'Generate Question'}
                  </Button>
                </div>
              )}

              {addTab === 'manual' && (
                <div className="space-y-3">
                  <TextArea
                    value={manualQ}
                    onChange={e => setManualQ(e.target.value)}
                    placeholder="Type your question here…"
                    rows={4}
                    className="resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide shrink-0">Marks</label>
                    <input
                      type="number"
                      min={1} max={20}
                      value={manualMarks}
                      onChange={e => setManualMarks(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-3 py-2 bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 rounded-xl text-sm focus:ring-2 focus:ring-accent-600 focus:border-transparent outline-none text-ink-900 dark:text-ink-100"
                    />
                  </div>
                  <Button className="w-full" onClick={handleAddManual} disabled={!manualQ.trim()}>
                    Add to Paper
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── RIGHT: Bank browser ───────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 dark:border-ink-800">
            <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">
              {meta.subject} — Question Bank
            </h3>
            <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">
              {chapters.length === 0 ? 'No chapters uploaded for this subject yet.' : `${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {chapters.length === 0 ? (
            <div className="py-16 text-center px-6">
              <Icon name="bank" className="w-8 h-8 text-ink-300 dark:text-ink-600 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-ink-400 dark:text-ink-500">No questions uploaded for <strong>{meta.subject}</strong> yet.</p>
              <p className="text-xs text-ink-300 dark:text-ink-600 mt-1">Use "Upload Questions" to add chapters first.</p>
            </div>
          ) : (
            <div className="divide-y divide-ink-100 dark:divide-ink-800 max-h-[70vh] overflow-y-auto">
              {chapters.map(ch => {
                const isOpen = openChapters.has(ch.id);
                const addedIds = new Set(
                  paperQuestions.filter(p => p.bankRef?.chapterId === ch.id).map(p => p.bankRef!.questionId),
                );
                const available = ch.questions.filter(q => !addedIds.has(q.id)).length;

                return (
                  <div key={ch.id}>
                    <div className="flex items-center gap-2 px-4 py-3">
                      <button
                        onClick={() => setOpenChapters(prev => {
                          const next = new Set(prev);
                          if (next.has(ch.id)) next.delete(ch.id); else next.add(ch.id);
                          return next;
                        })}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <Caret open={isOpen} className="w-3.5 h-3.5 text-ink-400" />
                        <span className="text-sm font-semibold text-ink-700 dark:text-ink-300">{ch.chapter}</span>
                        <span className="text-xs text-ink-400 dark:text-ink-500">{ch.questions.length}q</span>
                      </button>

                      {available > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={available}
                            value={randomN[ch.id] ?? 1}
                            onChange={e => setRandomN(prev => ({ ...prev, [ch.id]: Math.max(1, Math.min(available, parseInt(e.target.value) || 1)) }))}
                            className="w-10 text-center px-1 py-1 text-xs border border-ink-200 dark:border-ink-700 rounded-lg bg-white dark:bg-ink-800 text-ink-900 dark:text-ink-100 focus:ring-1 focus:ring-accent-600 outline-none"
                          />
                          <button
                            onClick={() => addRandomFromChapter(ch)}
                            className="px-2 py-1 text-xs font-semibold bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 rounded-lg hover:bg-accent-200 dark:hover:bg-accent-900/50 transition-colors"
                          >
                            Add random
                          </button>
                        </div>
                      )}
                    </div>

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
                                  ? 'bg-ink-50 dark:bg-ink-800/40 opacity-50'
                                  : isSwapMode
                                  ? 'hover:bg-accent-50 dark:hover:bg-accent-900/20 cursor-pointer'
                                  : 'hover:bg-ink-50 dark:hover:bg-ink-800/40 cursor-pointer'
                              }`}
                              onClick={() => !isAdded || isSwapMode ? addBankQuestion(ch, bq) : undefined}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-ink-700 dark:text-ink-300 leading-snug">{bq.question}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs font-bold text-ink-400 dark:text-ink-500">{bq.marks}m</span>
                                {isAdded && !isSwapMode ? (
                                  <Icon name="check" className="w-4 h-4 text-emerald-500" strokeWidth={2.5} />
                                ) : (
                                  <button
                                    onClick={e => { e.stopPropagation(); addBankQuestion(ch, bq); }}
                                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold transition-colors ${isSwapMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-accent-700 hover:bg-accent-800'}`}
                                    aria-label="Add to paper"
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
        </Card>
      </div>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function QuestionPaperBuilder({ userId = '' }: { userId?: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);

  if (!meta) {
    return <MetaForm onSubmit={setMeta} />;
  }

  return <PaperBuilder meta={meta} userId={userId} onBack={() => setMeta(null)} />;
}
