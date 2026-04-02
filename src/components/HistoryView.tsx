import { useState, useMemo, useRef, useEffect } from 'react';
import type { HistoryRecord, CheckingMode, QuestionResult } from '../types';
import { extractTextFromImage } from '../services/ocr';
import { getSemanticSimilarity } from '../services/similarity';
import { calculateMarks } from '../utils/scoring';
import { useExam } from '../context/ExamContext';
import { loadReports, updateReport, moveToTrash, restoreFromTrash, loadTrash, purgeExpiredTrash, deleteReport } from '../services/reports';
import type { TrashEntry } from '../services/reports';
import { supabase } from '../lib/supabase';

// ── Constants ────────────────────────────────────────────────────────────────

const MODE_THRESHOLDS: Record<CheckingMode, number> = { easy: 0.45, medium: 0.6, strict: 0.75 };

const MODE_LABELS: Record<CheckingMode, { label: string; color: string }> = {
  easy: { label: 'Easy', color: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800' },
  medium: { label: 'Medium', color: 'text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800' },
  strict: { label: 'Strict', color: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800' },
};

const gradeColors: Record<string, string> = {
  'A+': 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
  A: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
  B: 'text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30',
  C: 'text-yellow-700 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30',
  D: 'text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
  F: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
};

const rowColors = {
  full: 'bg-green-50 dark:bg-green-900/10',
  partial: 'bg-yellow-50 dark:bg-yellow-900/10',
  zero: 'bg-red-50 dark:bg-red-900/10',
  skipped: 'bg-slate-50 dark:bg-zinc-800/50',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tree = Map<number, Map<string, Map<string, Map<string, HistoryRecord[]>>>>;

function buildTree(records: HistoryRecord[]): Tree {
  const tree: Tree = new Map();
  for (const r of records) {
    const year = new Date(r.savedAt).getFullYear();
    const cls = r.examClass || 'Unclassified';
    const sec = r.studentSection || 'Unclassified';
    const sub = r.subject || 'General';
    if (!tree.has(year)) tree.set(year, new Map());
    const ym = tree.get(year)!;
    if (!ym.has(cls)) ym.set(cls, new Map());
    const cm = ym.get(cls)!;
    if (!cm.has(sec)) cm.set(sec, new Map());
    const sm = cm.get(sec)!;
    if (!sm.has(sub)) sm.set(sub, []);
    sm.get(sub)!.push(r);
  }
  return tree;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysLeft(deletedAt: string): number {
  const diff = 7 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(deletedAt).getTime());
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function buildAndPrint(r: HistoryRecord) {
  const questionsHtml = r.questions.map((q, idx) => {
    const result = r.results.find(res => res.questionId === q.id);
    const marksText = result
      ? `${result.marksAwarded} / ${q.marks} marks`
      : `0 / ${q.marks} marks — skipped`;
    const studentAnswer = result?.extractedText
      ? `<p style="font-size:10pt;margin:2pt 0 0;">${result.extractedText}</p>`
      : `<p style="font-size:10pt;color:#999;font-style:italic;margin:2pt 0 0;">No answer provided.</p>`;
    return `
      <div style="margin-bottom:16pt;page-break-inside:avoid;">
        <p style="font-size:11pt;font-weight:bold;margin:0 0 3pt;">
          Q${idx + 1}. ${q.question}
          <span style="font-weight:normal;color:#555;margin-left:8pt;">[${marksText}]</span>
        </p>
        <p style="font-size:9pt;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:4pt 0 1pt;">Student's Answer:</p>
        ${studentAnswer}
        <p style="font-size:9pt;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:6pt 0 1pt;">Expected Answer:</p>
        <p style="font-size:10pt;color:#333;margin:2pt 0 0;">${q.expectedAnswer}</p>
      </div>`;
  }).join('');

  const details = [
    r.studentName && `Student: ${r.studentName}`,
    r.studentId && `ID: ${r.studentId}`,
    r.studentSection && `Section: ${r.studentSection}`,
    r.term && `Term: ${r.term}`,
    r.savedAt && `Date: ${new Date(r.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`,
  ].filter(Boolean).join('  ·  ');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${r.examTitle}</title>
<style>body{font-family:serif;color:#000;margin:2cm;}@media print{body{margin:1.5cm;}}</style>
</head><body>
  <h1 style="font-size:20pt;font-weight:bold;margin:0 0 4pt;">${r.examTitle}${r.examClass ? ` — ${r.examClass}` : ''}</h1>
  <p style="font-size:11pt;margin:0 0 3pt;color:#333;">${details}</p>
  <p style="font-size:12pt;font-weight:bold;margin:0 0 10pt;">Marks: ${r.scored} / ${r.total} (${r.percentage}%)  —  Grade: ${r.grade}</p>
  ${r.subject ? `<p style="font-size:13pt;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4pt;margin:0 0 12pt;">${r.subject}</p>` : ''}
  ${questionsHtml}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}

// ── Update Modal ─────────────────────────────────────────────────────────────

interface QuestionPatch {
  newText: string;
  newScore: number;
  newMarks: number;
  newStatus: QuestionResult['status'];
  changed: boolean;
}

function UpdateModal({ record, hfApiKey, onClose, onSave }: {
  record: HistoryRecord;
  hfApiKey: string;
  onClose: () => void;
  onSave: (updated: HistoryRecord) => void;
}) {
  const geminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
  const [patches, setPatches] = useState<Map<number, QuestionPatch>>(new Map());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrError, setOcrError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const threshold = MODE_THRESHOLDS[record.checkingMode];
  const activeQuestion = record.questions.find(q => q.id === activeId);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    e.target.value = '';
    setOcrLoading(true);
    setOcrError('');
    setOcrText('');
    const ocr = await extractTextFromImage(file, undefined, geminiKey || undefined);
    setOcrLoading(false);
    if (ocr.error && !ocr.text) { setOcrError(ocr.error); return; }
    setOcrText(ocr.text);
  }

  async function handleAnalyze() {
    if (!ocrText.trim() || !activeQuestion) return;
    setAnalyzing(true);
    const sim = await getSemanticSimilarity(ocrText, activeQuestion.expectedAnswer, hfApiKey || undefined, activeQuestion.keywords ?? []);
    const { marks, status } = calculateMarks(sim.score, threshold, activeQuestion.marks);
    setPatches(prev => new Map(prev).set(activeId!, {
      newText: ocrText, newScore: sim.score, newMarks: marks, newStatus: status, changed: true,
    }));
    setAnalyzing(false);
  }

  function handleSave() {
    const updatedResults = record.results.map(r => {
      const patch = patches.get(r.questionId);
      if (!patch) return r;
      return { ...r, extractedText: patch.newText, similarityScore: patch.newScore, marksAwarded: patch.newMarks, status: patch.newStatus };
    });
    const scored = updatedResults.reduce((s, r) => s + r.marksAwarded, 0);
    const pct = record.total > 0 ? Math.round((scored / record.total) * 100) : 0;
    // Recalculate grade
    const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
    onSave({ ...record, results: updatedResults, scored, percentage: pct, grade });
  }

  const hasChanges = [...patches.values()].some(p => p.changed);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">Update Answers</h2>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{record.studentName} · {record.examTitle}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xl">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">Select a question to re-upload its image.</p>

          {record.questions.map((q, idx) => {
            const existing = record.results.find(r => r.questionId === q.id);
            const patch = patches.get(q.id);
            const isActive = activeId === q.id;

            return (
              <div key={q.id} className={`border rounded-xl transition-colors ${isActive ? 'border-purple-400 dark:border-purple-600' : 'border-slate-200 dark:border-zinc-700'}`}>
                <button
                  className="w-full text-left px-4 py-3 flex items-center gap-3"
                  onClick={() => { setActiveId(isActive ? null : q.id); setOcrText(''); setOcrError(''); }}
                >
                  <span className="text-xs font-semibold text-slate-400 w-5">Q{idx + 1}</span>
                  <span className="flex-1 text-sm text-gray-800 dark:text-zinc-200 truncate">{q.question}</span>
                  {patch?.changed && (
                    <span className="text-xs text-purple-700 dark:text-purple-400 font-medium">Updated</span>
                  )}
                  {!patch && existing && (
                    <span className="text-xs text-slate-400">{existing.marksAwarded}/{q.marks}</span>
                  )}
                </button>

                {isActive && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-zinc-800 pt-3">
                    {existing?.extractedText && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Current Answer</p>
                        <p className="text-xs font-mono text-slate-600 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-zinc-700">{existing.extractedText}</p>
                      </div>
                    )}

                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={ocrLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg text-sm font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-50"
                    >
                      {ocrLoading ? 'Reading image…' : 'Re-upload Image'}
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

                    {ocrError && <p className="text-xs text-red-600 dark:text-red-400">{ocrError}</p>}

                    {ocrText && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">New Extracted Text</p>
                        <textarea
                          value={ocrText} onChange={e => setOcrText(e.target.value)} rows={3}
                          className="w-full border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-none bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200"
                        />
                        <button onClick={handleAnalyze} disabled={analyzing}
                          className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                          {analyzing ? 'Analyzing…' : 'Analyze Answer'}
                        </button>
                      </div>
                    )}

                    {patch?.changed && (
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 text-sm text-green-800 dark:text-green-400">
                        New result: {patch.newMarks} / {q.marks} marks ({Math.round(patch.newScore * 100)}% similarity)
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 pb-5 pt-3 border-t border-slate-100 dark:border-zinc-800 flex gap-3">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!hasChanges}
            className="flex-1 py-2.5 bg-purple-700 text-white rounded-xl text-sm font-semibold hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Record detail panel ───────────────────────────────────────────────────────

function RecordDetail({ record }: { record: HistoryRecord }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{record.examTitle}</h3>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-sm text-slate-500 dark:text-zinc-400">
              {record.studentName && <span>{record.studentName}</span>}
              {record.examClass && record.studentSection && <span>{record.examClass} · {record.studentSection}</span>}
              {record.term && <span>{record.term}</span>}
              <span>{formatDate(record.savedAt)}</span>
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${MODE_LABELS[record.checkingMode].color}`}>
            {MODE_LABELS[record.checkingMode].label} Checking
          </span>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <div className="text-3xl font-bold text-gray-900 dark:text-zinc-100">
            {record.scored}<span className="text-slate-400 dark:text-zinc-500 text-xl"> / {record.total}</span>
          </div>
          <div className="text-xl font-semibold text-slate-600 dark:text-zinc-400">{record.percentage}%</div>
          <span className={`px-3 py-0.5 rounded-full text-lg font-bold ${gradeColors[record.grade] ?? 'bg-slate-100 dark:bg-zinc-800'}`}>{record.grade}</span>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-zinc-800">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-zinc-300">Question Breakdown</h4>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-zinc-800">
          {record.questions.map((q, idx) => {
            const result = record.results.find(r => r.questionId === q.id);
            const status = result?.status ?? 'skipped';
            const expanded = expandedId === q.id;
            return (
              <div key={q.id} className={rowColors[status]}>
                <button className="w-full text-left px-5 py-3 flex items-center gap-4" onClick={() => setExpandedId(expanded ? null : q.id)}>
                  <span className="text-xs font-semibold text-slate-400 dark:text-zinc-500 w-5">Q{idx + 1}</span>
                  <span className="flex-1 text-sm text-gray-800 dark:text-zinc-200 font-medium truncate">{q.question}</span>
                  {result && (
                    <>
                      <span className="text-xs text-slate-500 dark:text-zinc-400 w-20 text-right">{Math.round(result.similarityScore * 100)}% sim</span>
                      <span className="text-sm font-semibold w-16 text-right text-gray-800 dark:text-zinc-200">{result.marksAwarded} / {q.marks}</span>
                    </>
                  )}
                  {!result && <span className="text-xs text-slate-400 italic">not graded</span>}
                </button>
                {expanded && result && (
                  <div className="px-10 pb-4 space-y-2">
                    {result.extractedText && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-0.5">Student's Answer</p>
                        <p className="text-xs font-mono text-slate-700 dark:text-zinc-300 whitespace-pre-wrap bg-slate-50 dark:bg-zinc-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-zinc-700">{result.extractedText}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-0.5">Expected Answer</p>
                      <p className="text-xs font-mono text-slate-700 dark:text-zinc-300 whitespace-pre-wrap bg-slate-50 dark:bg-zinc-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-zinc-700">{q.expectedAnswer}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={() => buildAndPrint(record)} className="px-4 py-2 bg-zinc-800 dark:bg-zinc-700 text-white rounded-xl text-sm font-medium hover:bg-zinc-900 dark:hover:bg-zinc-600">
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

// ── Main HistoryView ──────────────────────────────────────────────────────────

export function HistoryView({ userId = '' }: { userId?: string }) {
  const { hfApiKey } = useExam();
  const histKey = userId ? `exam-history-${userId}` : 'exam-history';
  const [records, setRecords] = useState<HistoryRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(histKey) ?? '[]'); }
    catch { return []; }
  });

  // Merge Supabase records with localStorage on mount; also load trash
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      await purgeExpiredTrash(uid);
      const [remote, trash] = await Promise.all([loadReports(uid), loadTrash(uid)]);
      setTrashRecords(trash);
      if (remote.length === 0) return;
      setRecords(prev => {
        const localById = new Map(prev.map(r => [r.id, r]));
        for (const r of remote) localById.set(r.id, r);
        const merged = [...localById.values()].sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
        );
        localStorage.setItem(histKey, JSON.stringify(merged));
        return merged;
      });
    });
  }, []);

  const [view, setView] = useState<'history' | 'trash'>('history');
  const [trashRecords, setTrashRecords] = useState<TrashEntry[]>([]);
  const [permDeleteTarget, setPermDeleteTarget] = useState<TrashEntry | null>(null);
  const [permDeleteInput, setPermDeleteInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updateRecord, setUpdateRecord] = useState<HistoryRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryRecord | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());
  const [openClasses, setOpenClasses] = useState<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(records), [records]);
  const selected = records.find(r => r.id === selectedId) ?? null;

  function toggle<T>(set: Set<T>, val: T): Set<T> {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  }

  function saveUpdated(updated: HistoryRecord) {
    const next = records.map(r => r.id === updated.id ? updated : r);
    setRecords(next);
    localStorage.setItem(histKey, JSON.stringify(next));
    setUpdateRecord(null);
    // Persist to Supabase (fire-and-forget)
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        const userId = data.session?.user?.id;
        if (userId) updateReport(updated, userId);
      });
    }
  }

  function confirmDelete() {
    if (!deleteTarget || deleteInput !== 'DELETE') return;
    const trashedEntry: TrashEntry = { record: deleteTarget, deletedAt: new Date().toISOString() };
    const next = records.filter(r => r.id !== deleteTarget.id);
    setRecords(next);
    localStorage.setItem(histKey, JSON.stringify(next));
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setTrashRecords(prev => [trashedEntry, ...prev]);
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (uid) moveToTrash(deleteTarget.id, uid);
      });
    }
    setDeleteTarget(null);
    setDeleteInput('');
  }

  function handleRestore(entry: TrashEntry) {
    setTrashRecords(prev => prev.filter(t => t.record.id !== entry.record.id));
    setRecords(prev => {
      const next = [entry.record, ...prev].sort(
        (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
      );
      localStorage.setItem(histKey, JSON.stringify(next));
      return next;
    });
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (uid) restoreFromTrash(entry.record.id, uid);
      });
    }
  }

  function confirmPermDelete() {
    if (!permDeleteTarget || permDeleteInput !== 'DELETE') return;
    setTrashRecords(prev => prev.filter(t => t.record.id !== permDeleteTarget.record.id));
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (uid) deleteReport(permDeleteTarget.record.id, uid);
      });
    }
    setPermDeleteTarget(null);
    setPermDeleteInput('');
  }

  function printRecord(r: HistoryRecord) {
    buildAndPrint(r);
  }

  if (records.length === 0 && trashRecords.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-slate-700 dark:text-zinc-300 mb-1">No history yet</h3>
        <p className="text-sm text-slate-400 dark:text-zinc-500">Complete grading a student — reports are saved automatically.</p>
      </div>
    );
  }

  const sortedYears = [...tree.keys()].sort((a, b) => b - a);

  return (
    <>
      {/* Permanent delete modal (from trash) */}
      {permDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 p-6 w-full max-w-sm mx-4">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100 text-center mb-1">Delete Permanently</h3>
            <p className="text-sm text-slate-500 dark:text-zinc-400 text-center mb-1">
              <span className="font-medium text-slate-700 dark:text-zinc-300">{permDeleteTarget.record.studentName}</span> — {permDeleteTarget.record.examTitle}
            </p>
            <p className="text-xs text-slate-400 dark:text-zinc-500 text-center mb-4">This cannot be undone.</p>
            <p className="text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Type <span className="font-bold text-red-500">DELETE</span> to confirm</p>
            <input
              type="text"
              value={permDeleteInput}
              onChange={e => setPermDeleteInput(e.target.value)}
              placeholder="DELETE"
              autoFocus
              className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500 mb-4 font-mono"
            />
            <div className="flex gap-3">
              <button
                onClick={confirmPermDelete}
                disabled={permDeleteInput !== 'DELETE'}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Delete Forever
              </button>
              <button
                onClick={() => { setPermDeleteTarget(null); setPermDeleteInput(''); }}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move-to-trash confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 p-6 w-full max-w-sm mx-4">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100 text-center mb-1">Move to Trash</h3>
            <p className="text-sm text-slate-500 dark:text-zinc-400 text-center mb-1">
              <span className="font-medium text-slate-700 dark:text-zinc-300">{deleteTarget.studentName}</span> — {deleteTarget.examTitle}
            </p>
            <p className="text-xs text-slate-400 dark:text-zinc-500 text-center mb-4">Report will be permanently deleted after 7 days.</p>
            <p className="text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Type <span className="font-bold text-red-500">DELETE</span> to confirm</p>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              autoFocus
              className="w-full border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500 mb-4 font-mono"
            />
            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                disabled={deleteInput !== 'DELETE'}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Move to Trash
              </button>
              <button
                onClick={() => { setDeleteTarget(null); setDeleteInput(''); }}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {updateRecord && (
        <UpdateModal
          record={updateRecord}
          hfApiKey={hfApiKey}
          onClose={() => setUpdateRecord(null)}
          onSave={saveUpdated}
        />
      )}

      <div className="max-w-5xl mx-auto">
        {/* Tab bar */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setView('history')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'history' ? 'bg-purple-700 text-white' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
          >
            Archive
            {records.length > 0 && <span className="ml-1.5 text-xs opacity-75">({records.length})</span>}
          </button>
          <button
            onClick={() => setView('trash')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'trash' ? 'bg-red-600 text-white' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
          >
            Trash
            {trashRecords.length > 0 && <span className="ml-1.5 text-xs opacity-75">({trashRecords.length})</span>}
          </button>
        </div>

        {/* Trash panel */}
        {view === 'trash' && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">Trash</h3>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">Reports are permanently deleted 7 days after being trashed.</p>
            </div>
            {trashRecords.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm text-slate-400 dark:text-zinc-500">Trash is empty.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                {trashRecords.map(entry => {
                  const days = daysLeft(entry.deletedAt);
                  return (
                    <div key={entry.record.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-zinc-200 truncate">
                          {entry.record.studentName || 'Unknown'} — {entry.record.examTitle}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
                          Deleted {formatDate(entry.deletedAt)} · {entry.record.examClass} {entry.record.studentSection}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${days <= 1 ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700'}`}>
                        {days}d left
                      </span>
                      <button
                        onClick={() => handleRestore(entry)}
                        className="shrink-0 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => { setPermDeleteTarget(entry); setPermDeleteInput(''); }}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete permanently"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === 'history' && <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">

          {/* Left: tree */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">Archive</h3>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{records.length} record{records.length !== 1 ? 's' : ''}</p>
            </div>

            <div className="py-1">
              {sortedYears.map(year => {
                const classMap = tree.get(year)!;
                const yearOpen = openYears.has(year);
                return (
                  <div key={year}>
                    <button onClick={() => setOpenYears(toggle(openYears, year))}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800">
                      <svg className={`w-3 h-3 transition-transform ${yearOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                        <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {year}
                    </button>

                    {yearOpen && [...classMap.keys()].map(cls => {
                      const sectionMap = classMap.get(cls)!;
                      const clsKey = `${year}-${cls}`;
                      const clsOpen = openClasses.has(clsKey);
                      return (
                        <div key={cls}>
                          <button onClick={() => setOpenClasses(toggle(openClasses, clsKey))}
                            className="w-full flex items-center gap-2 pl-8 pr-4 py-1.5 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800">
                            <svg className={`w-3 h-3 transition-transform ${clsOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                              <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {cls}
                          </button>

                          {clsOpen && [...sectionMap.keys()].map(sec => {
                            const subjectMap = sectionMap.get(sec)!;
                            const secKey = `${year}-${cls}-${sec}`;
                            const secOpen = openSections.has(secKey);
                            const secTotal = [...subjectMap.values()].reduce((n, arr) => n + arr.length, 0);
                            return (
                              <div key={sec}>
                                <button onClick={() => setOpenSections(toggle(openSections, secKey))}
                                  className="w-full flex items-center gap-2 pl-12 pr-4 py-1.5 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800">
                                  <svg className={`w-3 h-3 transition-transform ${secOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                                    <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  Section {sec}
                                  <span className="ml-auto text-slate-400">{secTotal}</span>
                                </button>

                                {secOpen && [...subjectMap.keys()].map(sub => {
                                  const subRecords = subjectMap.get(sub)!;
                                  const subKey = `${year}-${cls}-${sec}-${sub}`;
                                  const subOpen = openSubjects.has(subKey);
                                  return (
                                    <div key={sub}>
                                      <button onClick={() => setOpenSubjects(toggle(openSubjects, subKey))}
                                        className="w-full flex items-center gap-2 pl-16 pr-4 py-1.5 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 italic">
                                        <svg className={`w-3 h-3 transition-transform shrink-0 ${subOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                                          <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        <span className="truncate">{sub}</span>
                                        <span className="ml-auto text-slate-400 shrink-0">{subRecords.length}</span>
                                      </button>

                                      {subOpen && subRecords.map(r => (
                                        <div key={r.id} className="group relative">
                                          <button
                                            onClick={() => setSelectedId(r.id)}
                                            className={`w-full text-left pl-20 pr-20 py-2 transition-colors ${
                                              selectedId === r.id
                                                ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                                                : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
                                            }`}
                                          >
                                            <p className="text-xs font-medium truncate">{r.studentName || 'Unknown'}</p>
                                            <p className="text-xs text-slate-400 dark:text-zinc-500">{r.percentage}% · {r.grade}</p>
                                          </button>

                                          {/* Action icons — always visible on mobile, hover-only on desktop */}
                                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
                                            <button
                                              onClick={e => { e.stopPropagation(); printRecord(r); }}
                                              title="Print report"
                                              className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700"
                                            >
                                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                              </svg>
                                            </button>
                                            <button
                                              onClick={e => { e.stopPropagation(); setUpdateRecord(r); }}
                                              title="Update answers"
                                              className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700"
                                            >
                                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                              </svg>
                                            </button>
                                            <button
                                              onClick={e => { e.stopPropagation(); setDeleteTarget(r); setDeleteInput(''); }}
                                              title="Delete report"
                                              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                            >
                                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                              </svg>
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: detail */}
          <div>
            {selected
              ? <RecordDetail record={selected} />
              : (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 py-20 text-center">
                  <p className="text-sm text-slate-400 dark:text-zinc-500">Select a record from the archive to view details.</p>
                </div>
              )
            }
          </div>

        </div>}

      </div>
    </>
  );
}
