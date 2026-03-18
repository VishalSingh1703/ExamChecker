import { useState, useRef } from 'react';
import type { AnswerKey } from '../types';
import { useExamDispatch } from '../context/ExamContext';

const SAMPLE_URL = '/sample-answer-key.json';

const TEMPLATE_JSON = `{
  "exam": {
    "title": "My Exam",
    "subject": "Subject Name",
    "totalMarks": 30
  },
  "questions": [
    {
      "id": 1,
      "question": "Your first question here?",
      "expectedAnswer": "The expected answer for question 1.",
      "marks": 10,
      "threshold": 0.6
    },
    {
      "id": 2,
      "question": "Your second question here?",
      "expectedAnswer": "The expected answer for question 2.",
      "marks": 10,
      "threshold": 0.6
    },
    {
      "id": 3,
      "question": "Your third question here?",
      "expectedAnswer": "The expected answer for question 3.",
      "marks": 10,
      "threshold": 0.6
    }
  ]
}`;

export function ExamSetup() {
  const dispatch = useExamDispatch();
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [savedKey, setSavedKey] = useState<AnswerKey | null>(null);
  const [marksWarning, setMarksWarning] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Real-time validation only — does NOT save
  function validateJson(text: string): AnswerKey | null {
    try {
      const data = JSON.parse(text) as AnswerKey;
      if (!data.exam || !Array.isArray(data.questions)) {
        setJsonError('Missing "exam" or "questions" fields');
        return null;
      }
      setJsonError('');
      return data;
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
      return null;
    }
  }

  function handleTextChange(text: string) {
    setJsonText(text);
    setSavedKey(null);
    setMarksWarning('');
    if (text.trim()) validateJson(text);
    else setJsonError('');
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setJsonText(text);
      setSavedKey(null);
      setMarksWarning('');
      validateJson(text);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  }

  async function loadSample() {
    const res = await fetch(SAMPLE_URL);
    const text = await res.text();
    setJsonText(text);
    setSavedKey(null);
    setMarksWarning('');
    validateJson(text);
  }

  function loadTemplate() {
    setJsonText(TEMPLATE_JSON);
    setSavedKey(null);
    setMarksWarning('');
    validateJson(TEMPLATE_JSON);
  }

  function handleSave() {
    const data = validateJson(jsonText);
    if (!data) return;

    const sumMarks = data.questions.reduce((s, q) => s + (q.marks ?? 0), 0);
    if (sumMarks !== data.exam.totalMarks) {
      setMarksWarning(
        `Total marks in "exam" (${data.exam.totalMarks}) does not equal the sum of question marks (${sumMarks}). Please update your JSON.`
      );
    } else {
      setMarksWarning('');
    }

    setSavedKey(data);
  }

  function handleStart() {
    if (!savedKey) return;
    dispatch({ type: 'SET_ANSWER_KEY', payload: savedKey });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'grade' });
  }

  const canSave = jsonText.trim().length > 0 && !jsonError;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Load Answer Key</h2>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload JSON
          </button>
          <button
            onClick={loadTemplate}
            className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg text-sm font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Type JSON
          </button>
          <button
            onClick={loadSample}
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Load Sample
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
        </div>

        {/* Textarea */}
        <textarea
          value={jsonText}
          onChange={(e) => handleTextChange(e.target.value)}
          className="w-full h-72 font-mono text-xs border border-gray-300 dark:border-gray-700 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
          placeholder='Paste your answer key JSON here, upload a file, or click "Type JSON" for a template…'
          spellCheck={false}
        />

        {/* Real-time JSON error */}
        {jsonError && (
          <p className="mt-2 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {jsonError}
          </p>
        )}

        {/* Marks mismatch warning */}
        {marksWarning && (
          <p className="mt-2 text-yellow-700 dark:text-yellow-400 text-sm bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2">
            ⚠ {marksWarning}
          </p>
        )}

        {/* Success summary (after Save) */}
        {savedKey && (
          <div className="mt-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 text-sm text-green-800 dark:text-green-400">
            <span className="font-medium">{savedKey.exam.title}</span>
            {' — '}
            <span>{savedKey.questions.length} question{savedKey.questions.length !== 1 ? 's' : ''}</span>
            {', '}
            <span>{savedKey.exam.totalMarks} total marks</span>
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="mt-3 w-full py-2.5 bg-gray-800 dark:bg-gray-700 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save Answer Key
        </button>
      </div>

      {/* Start Grading */}
      <button
        onClick={handleStart}
        disabled={!savedKey}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-base hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
      >
        Start Grading →
      </button>
    </div>
  );
}
