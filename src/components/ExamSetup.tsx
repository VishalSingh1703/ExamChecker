import { useState, useRef } from 'react';
import type { AnswerKey } from '../types';
import { useExamDispatch } from '../context/ExamContext';

const SAMPLE_URL = '/sample-answer-key.json';

export function ExamSetup() {
  const dispatch = useExamDispatch();
  const [jsonText, setJsonText] = useState('');
  const [parsed, setParsed] = useState<AnswerKey | null>(null);
  const [jsonError, setJsonError] = useState('');
  const [hfKey, setHfKey] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function parseJson(text: string) {
    try {
      const data = JSON.parse(text) as AnswerKey;
      if (!data.exam || !Array.isArray(data.questions)) {
        throw new Error('Missing "exam" or "questions" fields');
      }
      setParsed(data);
      setJsonError('');
    } catch (e) {
      setParsed(null);
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setJsonText(text);
      parseJson(text);
    };
    reader.readAsText(file);
  }

  async function loadSample() {
    const res = await fetch(SAMPLE_URL);
    const text = await res.text();
    setJsonText(text);
    parseJson(text);
  }

  function handleTextChange(text: string) {
    setJsonText(text);
    parseJson(text);
  }

  function handleStart() {
    if (!parsed) return;
    dispatch({ type: 'SET_ANSWER_KEY', payload: parsed });
    if (hfKey) dispatch({ type: 'SET_HF_API_KEY', payload: hfKey });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'grade' });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Load Answer Key</h2>

        <div className="flex gap-3 mb-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100"
          >
            Upload JSON
          </button>
          <button
            onClick={loadSample}
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-100"
          >
            Load Sample
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
        </div>

        <textarea
          value={jsonText}
          onChange={(e) => handleTextChange(e.target.value)}
          className="w-full h-64 font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder='Paste your answer key JSON here or upload a file…'
          spellCheck={false}
        />

        {jsonError && (
          <p className="mt-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {jsonError}
          </p>
        )}

        {parsed && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            <span className="font-medium">{parsed.exam.title}</span> — {parsed.questions.length} questions,{' '}
            {parsed.exam.totalMarks} total marks
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Hugging Face API Key <span className="text-gray-400 font-normal text-sm">(optional)</span>
        </h2>
        <p className="text-gray-500 text-sm mb-3">
          Improves semantic scoring. Without it, keyword overlap is used as fallback.
        </p>
        <input
          type="password"
          value={hfKey}
          onChange={(e) => setHfKey(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="hf_…"
        />
      </div>

      <button
        onClick={handleStart}
        disabled={!parsed}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-base hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
      >
        Start Grading →
      </button>
    </div>
  );
}
