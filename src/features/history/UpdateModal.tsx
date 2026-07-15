import { useState, useRef } from 'react';
import type { HistoryRecord, QuestionResult } from '../../types';
import { extractTextFromImage } from '../../services/ai/ocr';
import { getSemanticSimilarity } from '../../services/ai/similarity';
import { calculateMarksByMode, getGrade } from '../../utils/scoring';
import { Button, Modal } from '../../components/ui';

interface QuestionPatch {
  newText: string;
  newScore: number;
  newMarks: number;
  newStatus: QuestionResult['status'];
  changed: boolean;
}

interface Props {
  record: HistoryRecord;
  hfApiKey: string;
  geminiApiKey: string;
  onClose: () => void;
  onSave: (updated: HistoryRecord) => void;
}

export function UpdateModal({ record, hfApiKey, geminiApiKey, onClose, onSave }: Props) {
  const [patches, setPatches] = useState<Map<number, QuestionPatch>>(new Map());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrError, setOcrError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const activeQuestion = record.questions.find(q => q.id === activeId);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    e.target.value = '';
    setOcrLoading(true);
    setOcrError('');
    setOcrText('');
    try {
      const ocr = await extractTextFromImage(file, undefined, geminiApiKey || undefined);
      if (!ocr.text) { setOcrError('Could not extract text from image.'); return; }
      setOcrText(ocr.text);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Could not read the image.');
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleAnalyze() {
    if (!ocrText.trim() || !activeQuestion) return;
    setAnalyzing(true);
    const sim = await getSemanticSimilarity(ocrText, activeQuestion.expectedAnswer, hfApiKey || undefined, activeQuestion.keywords ?? [], activeQuestion.marks, geminiApiKey || undefined);
    const { marks, status } = calculateMarksByMode(sim.score, record.checkingMode, activeQuestion.marks);
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
    onSave({ ...record, results: updatedResults, scored, percentage: pct, grade: getGrade(pct) });
  }

  const hasChanges = [...patches.values()].some(p => p.changed);

  return (
    <Modal onClose={onClose} size="max-w-2xl">
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Update Answers</h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{record.studentName} · {record.examTitle}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xl">×</button>
      </div>

      <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Select a question to re-upload its image.</p>

        {record.questions.map((q, idx) => {
          const existing = record.results.find(r => r.questionId === q.id);
          const patch = patches.get(q.id);
          const isActive = activeId === q.id;

          return (
            <div key={q.id} className={`border rounded-xl transition-colors ${isActive ? 'border-purple-400 dark:border-purple-600' : 'border-zinc-200 dark:border-zinc-700'}`}>
              <button
                className="w-full text-left px-4 py-3 flex items-center gap-3"
                onClick={() => { setActiveId(isActive ? null : q.id); setOcrText(''); setOcrError(''); }}
              >
                <span className="text-xs font-semibold text-zinc-400 w-6">Q{idx + 1}</span>
                <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200 truncate">{q.question}</span>
                {patch?.changed && (
                  <span className="text-xs text-purple-700 dark:text-purple-400 font-medium">Updated</span>
                )}
                {!patch && existing && (
                  <span className="text-xs text-zinc-400">{existing.marksAwarded}/{q.marks}</span>
                )}
              </button>

              {isActive && (
                <div className="px-4 pb-4 space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                  {existing?.extractedText && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Current Answer</p>
                      <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2 border border-zinc-200 dark:border-zinc-700">{existing.extractedText}</p>
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
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">New Extracted Text</p>
                      <textarea
                        value={ocrText} onChange={e => setOcrText(e.target.value)} rows={3}
                        className="w-full border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent resize-none bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
                      />
                      <button onClick={handleAnalyze} disabled={analyzing}
                        className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                        {analyzing ? 'Analyzing…' : 'Analyze Answer'}
                      </button>
                    </div>
                  )}

                  {patch?.changed && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-sm text-emerald-800 dark:text-emerald-400">
                      New result: {patch.newMarks} / {q.marks} marks ({Math.round(patch.newScore * 100)}% similarity)
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-6 pb-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" onClick={handleSave} disabled={!hasChanges}>
          Save Changes
        </Button>
      </div>
    </Modal>
  );
}
