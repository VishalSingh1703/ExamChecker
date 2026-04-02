import { useState, useRef } from 'react';
import type { Question, QuestionResult } from '../types';
import { extractAndGrade, extractTextFromImage } from '../services/ocr';
import { getSemanticSimilarity } from '../services/similarity';
import { calculateMarks } from '../utils/scoring';

interface Props {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  threshold: number;
  hfApiKey: string;
  geminiApiKey: string;
  onSave: (result: QuestionResult) => void;
  onSkip: () => void;
}

export function QuestionGrader({
  question,
  questionNumber,
  totalQuestions,
  threshold,
  hfApiKey,
  geminiApiKey,
  onSave,
  onSkip,
}: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrEngine, setOcrEngine] = useState<'gemini' | 'tesseract' | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<{
    similarity: number;
    method: 'semantic' | 'keyword';
    marks: number;
    status: QuestionResult['status'];
    fallbackReason?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setOcrText('');
    setResult(null);
    setOcrError('');
    runOCRAndGrade(file);
  }

  async function runOCRAndGrade(file: File) {
    setOcrLoading(true);
    setOcrProgress(10);

    // Try combined OCR + grade in one Gemini call
    if (geminiApiKey?.trim()) {
      try {
        const combined = await extractAndGrade(
          file,
          question.question,
          question.expectedAnswer,
          question.keywords ?? [],
          geminiApiKey.trim(),
        );
        setOcrProgress(100);
        setOcrLoading(false);
        setOcrEngine('gemini');
        setOcrText(combined.extractedText);
        const { marks, status } = calculateMarks(combined.score, threshold, question.marks);
        setResult({ similarity: combined.score, method: 'semantic', marks, status });
        return;
      } catch (err) {
        console.error('[QuestionGrader] Combined Gemini call failed, falling back:', err instanceof Error ? err.message : err);
        // Fall through to separate OCR + similarity below
      }
    }

    // Fallback: separate OCR then similarity
    const ocr = await extractTextFromImage(file, setOcrProgress, geminiApiKey || undefined);
    setOcrLoading(false);
    setOcrEngine(ocr.usedGemini ? 'gemini' : 'tesseract');
    if (ocr.error && !ocr.text) {
      setOcrError(ocr.error);
      return;
    }
    if (ocr.error) setOcrError(ocr.error);
    setOcrText(ocr.text);

    // Auto-analyze after OCR
    if (ocr.text.trim()) {
      setAnalyzing(true);
      const sim = await getSemanticSimilarity(ocr.text, question.expectedAnswer, hfApiKey || undefined, question.keywords ?? []);
      const { marks, status } = calculateMarks(sim.score, threshold, question.marks);
      setResult({ similarity: sim.score, method: sim.method, marks, status, fallbackReason: sim.error });
      setAnalyzing(false);
    }
  }

  async function handleReanalyze() {
    setShowConfirm(false);
    if (!ocrText.trim()) return;
    setAnalyzing(true);
    setResult(null);
    const sim = await getSemanticSimilarity(ocrText, question.expectedAnswer, hfApiKey || undefined, question.keywords ?? []);
    const { marks, status } = calculateMarks(sim.score, threshold, question.marks);
    setResult({ similarity: sim.score, method: sim.method, marks, status, fallbackReason: sim.error });
    setAnalyzing(false);
  }

  function handleSave() {
    if (!result) return;
    onSave({
      questionId: question.id,
      extractedText: ocrText,
      similarityScore: result.similarity,
      similarityMethod: result.method,
      marksAwarded: result.marks,
      maxMarks: question.marks,
      status: result.status,
    });
  }

  const statusColors = {
    full: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    partial: 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    zero: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    skipped: 'text-slate-600 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700',
  };

  return (
    <div className="space-y-4">
      {/* Confirm re-analyze popup */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100 mb-2">Re-analyze answer?</h3>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mb-5">
              This will overwrite the current result with a fresh analysis of the edited text.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleReanalyze}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700"
              >
                Yes, analyze again
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question header */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium uppercase tracking-wide mb-1">
              Question {questionNumber} of {totalQuestions}
            </p>
            <p className="text-base font-semibold text-gray-900 dark:text-zinc-100">{question.question}</p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-1">
            {question.marks} marks
          </span>
        </div>
      </div>

      {/* Two-column grading area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: image */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-zinc-300">Answer Image</h3>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 w-full py-2 border-2 border-dashed border-slate-300 dark:border-zinc-700 rounded-xl text-sm text-slate-500 dark:text-zinc-400 hover:border-purple-400 dark:hover:border-purple-600 hover:text-purple-700 dark:hover:text-purple-400"
          >
            {imageFile ? 'Change Image' : 'Upload Image'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

          {imageUrl && (
            <img
              src={imageUrl}
              alt="Answer"
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 object-contain max-h-64"
            />
          )}

          {(ocrLoading || analyzing) && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-500 dark:text-zinc-400">
                <span>{ocrLoading ? 'Reading & grading…' : 'Analyzing…'}</span>
                <span>{ocrLoading ? `${ocrProgress}%` : ''}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-zinc-700 rounded-full h-1.5">
                <div
                  className="bg-purple-600 h-1.5 rounded-full transition-all"
                  style={{ width: ocrLoading ? `${ocrProgress}%` : '60%' }}
                />
              </div>
            </div>
          )}

          {ocrEngine && !ocrLoading && (
            <p className={`text-xs rounded-lg px-3 py-1.5 border ${ocrEngine === 'gemini' ? 'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800' : 'text-slate-600 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700'}`}>
              {ocrEngine === 'gemini' ? 'AI reading — OCR + graded in one pass ✓' : 'OCR fallback mode'}
            </p>
          )}

          {ocrError && (
            <p className="text-red-600 dark:text-red-400 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              OCR error: {ocrError}
            </p>
          )}
        </div>

        {/* Right: extracted text + analysis */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-zinc-300">Extracted Text</h3>
          <textarea
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            className="flex-1 min-h-[120px] border border-slate-300 dark:border-zinc-700 rounded-xl p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent resize-none bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600"
            placeholder="Upload an image to extract and grade automatically, or type directly…"
          />

          {result && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!ocrText.trim() || analyzing || ocrLoading}
              className="w-full py-2 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 dark:border-zinc-700"
            >
              {analyzing ? 'Analyzing…' : 'Analyze Again'}
            </button>
          )}

          {result && (
            <div className={`border rounded-xl px-4 py-3 text-sm space-y-2 ${statusColors[result.status]}`}>
              {result.method === 'keyword' && result.fallbackReason && (
                <p className="text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2 text-xs">
                  Using keyword fallback (semantic API unavailable)
                </p>
              )}
              <div className="flex justify-between font-medium">
                <span>Similarity: {Math.round(result.similarity * 100)}%</span>
                <span>{result.marks} / {question.marks} marks</span>
              </div>
              <div className="text-xs capitalize">
                Method: {result.method} · Status: {result.status}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!result}
          className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save &amp; Next
        </button>
        <button
          onClick={onSkip}
          className="px-5 py-2.5 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-zinc-700"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
