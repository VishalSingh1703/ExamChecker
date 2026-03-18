import { useState, useRef } from 'react';
import type { Question, QuestionResult } from '../types';
import { extractTextFromImage } from '../services/ocr';
import { getSemanticSimilarity } from '../services/similarity';
import { calculateMarks } from '../utils/scoring';

interface Props {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  hfApiKey: string;
  onSave: (result: QuestionResult) => void;
  onSkip: () => void;
}

export function QuestionGrader({
  question,
  questionNumber,
  totalQuestions,
  hfApiKey,
  onSave,
  onSkip,
}: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
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
    runOCR(file);
  }

  async function runOCR(file: File) {
    setOcrLoading(true);
    setOcrProgress(0);
    const ocr = await extractTextFromImage(file, setOcrProgress);
    setOcrLoading(false);
    if (ocr.error) {
      setOcrError(ocr.error);
    } else {
      setOcrText(ocr.text);
    }
  }

  async function handleAnalyze() {
    if (!ocrText.trim()) return;
    setAnalyzing(true);
    setResult(null);
    const sim = await getSemanticSimilarity(ocrText, question.expectedAnswer, hfApiKey || undefined);
    const { marks, status } = calculateMarks(sim.score, question.threshold, question.marks);
    setResult({
      similarity: sim.score,
      method: sim.method,
      marks,
      status,
      fallbackReason: sim.error,
    });
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
    full: 'text-green-700 bg-green-50 border-green-200',
    partial: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    zero: 'text-red-700 bg-red-50 border-red-200',
    skipped: 'text-gray-600 bg-gray-50 border-gray-200',
  };

  return (
    <div className="space-y-4">
      {/* Question header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">
              Question {questionNumber} of {totalQuestions}
            </p>
            <p className="text-base font-semibold text-gray-900">{question.question}</p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1">
            {question.marks} marks
          </span>
        </div>
      </div>

      {/* Two-column grading area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: image */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Answer Image</h3>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600"
          >
            {imageFile ? 'Change Image' : 'Upload Image'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

          {imageUrl && (
            <img
              src={imageUrl}
              alt="Answer"
              className="w-full rounded-xl border border-gray-200 object-contain max-h-64"
            />
          )}

          {ocrLoading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Running OCR…</span>
                <span>{ocrProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${ocrProgress}%` }}
                />
              </div>
            </div>
          )}

          {ocrError && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              OCR error: {ocrError}
            </p>
          )}
        </div>

        {/* Right: extracted text + analysis */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Extracted Text</h3>
          <textarea
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            className="flex-1 min-h-[120px] border border-gray-300 rounded-xl p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Upload an image to extract text, or type directly…"
          />

          <button
            onClick={handleAnalyze}
            disabled={!ocrText.trim() || analyzing}
            className="w-full py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {analyzing ? 'Analyzing…' : 'Analyze Answer'}
          </button>

          {result && (
            <div className={`border rounded-xl px-4 py-3 text-sm space-y-2 ${statusColors[result.status]}`}>
              {result.method === 'keyword' && result.fallbackReason && (
                <p className="text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs">
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
          className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
