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
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ink-100 dark:border-ink-800">
        <div>
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100">Update Answers</h2>
          <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">{record.studentName} · {record.examTitle}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-600 hover:bg-ink-100 dark:hover:bg-ink-800 text-xl">×</button>
      </div>

      <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
        <p className="text-xs text-ink-500 dark:text-ink-400">Select a question to re-upload its image.</p>

        {record.questions.map((q, idx) => {
          const existing = record.results.find(r => r.questionId === q.id);
          const patch = patches.get(q.id);
          const isActive = activeId === q.id;

          return (
            <div key={q.id} className={`border rounded-xl transition-colors ${isActive ? 'border-accent-400 dark:border-accent-600' : 'border-ink-200 dark:border-ink-700'}`}>
              <button
                className="w-full text-left px-4 py-3 flex items-center gap-3"
                onClick={() => { setActiveId(isActive ? null : q.id); setOcrText(''); setOcrError(''); }}
              >
                <span className="text-xs font-semibold text-ink-400 w-6">Q{idx + 1}</span>
                <span className="flex-1 text-sm text-ink-800 dark:text-ink-200 truncate">{q.question}</span>
                {patch?.changed && (
                  <span className="text-xs text-accent-700 dark:text-accent-400 font-medium">Updated</span>
                )}
                {!patch && existing && (
                  <span className="text-xs text-ink-400">{existing.marksAwarded}/{q.marks}</span>
                )}
              </button>

              {isActive && (
                <div className="px-4 pb-4 space-y-3 border-t border-ink-100 dark:border-ink-800 pt-3">
                  {existing?.extractedText && (
                    <div>
                      <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">Current Answer</p>
                      <p className="text-xs font-mono text-ink-600 dark:text-ink-400 bg-ink-50 dark:bg-ink-800 rounded-lg px-3 py-2 border border-ink-200 dark:border-ink-700">{existing.extractedText}</p>
                    </div>
                  )}

                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={ocrLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 border border-accent-200 dark:border-accent-800 rounded-lg text-sm font-medium hover:bg-accent-100 dark:hover:bg-accent-900/50 disabled:opacity-50"
                  >
                    {ocrLoading ? 'Reading image…' : 'Re-upload Image'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

                  {ocrError && <p className="text-xs text-red-600 dark:text-red-400">{ocrError}</p>}

                  {ocrText && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-ink-500 dark:text-ink-400">New Extracted Text</p>
                      <textarea
                        value={ocrText} onChange={e => setOcrText(e.target.value)} rows={3}
                        className="w-full border border-ink-200 dark:border-ink-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent-600 focus:border-transparent resize-none bg-white dark:bg-ink-800 text-ink-800 dark:text-ink-200"
                      />
                      <button onClick={handleAnalyze} disabled={analyzing}
                        className="w-full py-2 bg-accent-600 text-white rounded-lg text-sm font-medium hover:bg-accent-700 disabled:opacity-50">
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

      <div className="px-6 pb-5 pt-3 border-t border-ink-100 dark:border-ink-800 flex gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" onClick={handleSave} disabled={!hasChanges}>
          Save Changes
        </Button>
      </div>
    </Modal>
  );
}
