import { useState } from 'react';
import { useExam, useExamDispatch } from '../context/ExamContext';
import { calculateTotalScore, getGrade } from '../utils/scoring';

export function ReportView() {
  const { answerKey, results } = useExam();
  const dispatch = useExamDispatch();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (!answerKey) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-16">No exam data to report.</div>
    );
  }

  const { scored, total, percentage } = calculateTotalScore(results);
  const grade = getGrade(percentage);

  const gradeColors: Record<string, string> = {
    'A+': 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    A: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    B: 'text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30',
    C: 'text-yellow-700 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30',
    D: 'text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
    F: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
  };

  const rowColors = {
    full: 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900',
    partial: 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-100 dark:border-yellow-900',
    zero: 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900',
    skipped: 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 print:space-y-4">
      {/* Print header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold">{answerKey.exam.title}</h1>
        <p className="text-gray-600">{answerKey.exam.subject}</p>
      </div>

      {/* Score card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 print:shadow-none print:border print:border-gray-300">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{answerKey.exam.title}</h2>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            {scored}{' '}
            <span className="text-gray-400 dark:text-gray-500 text-2xl">/ {total}</span>
          </div>
          <div className="text-2xl font-semibold text-gray-600 dark:text-gray-400">{percentage}%</div>
          <span className={`px-4 py-1 rounded-full text-xl font-bold ${gradeColors[grade] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
            {grade}
          </span>
        </div>
      </div>

      {/* Per-question table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden print:shadow-none">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">Question Breakdown</h3>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {answerKey.questions.map((q, idx) => {
            const result = results.find((r) => r.questionId === q.id);
            const status = result?.status ?? 'skipped';
            const expanded = expandedId === q.id;

            return (
              <div key={q.id} className={`${rowColors[status]} border-b last:border-0`}>
                <button
                  className="w-full text-left px-5 py-3 flex items-center gap-4 print:pointer-events-none"
                  onClick={() => setExpandedId(expanded ? null : q.id)}
                >
                  <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-5">Q{idx + 1}</span>
                  <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                    {q.question}
                  </span>
                  {result && (
                    <>
                      <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right">
                        {Math.round(result.similarityScore * 100)}% sim
                      </span>
                      <span className="text-sm font-semibold w-16 text-right text-gray-800 dark:text-gray-200">
                        {result.marksAwarded} / {q.marks}
                      </span>
                    </>
                  )}
                  {!result && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">not graded</span>
                  )}
                </button>

                {result?.extractedText && (
                  <div className={`px-10 pb-3 text-xs text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap ${!expanded ? 'hidden print:block' : ''}`}>
                    {result.extractedText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 print:hidden">
        <button
          onClick={() => window.print()}
          className="px-5 py-2.5 bg-gray-800 dark:bg-gray-700 text-white rounded-xl text-sm font-medium hover:bg-gray-900 dark:hover:bg-gray-600"
        >
          Print / Save as PDF
        </button>
        <button
          onClick={() => dispatch({ type: 'RESET_SESSION' })}
          className="px-5 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          New Exam
        </button>
      </div>
    </div>
  );
}
