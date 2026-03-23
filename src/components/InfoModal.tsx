const SAMPLE_JSON = `{
  "exam": {
    "title": "Biology Mid-Term",
    "subject": "Biology",
    "totalMarks": 30
  },
  "questions": [
    {
      "id": 1,
      "question": "What is photosynthesis?",
      "expectedAnswer": "Photosynthesis is the process by which plants use sunlight, water and carbon dioxide to produce glucose and oxygen.",
      "marks": 10,
      "threshold": 0.6
    },
    {
      "id": 2,
      "question": "Describe the cell membrane.",
      "expectedAnswer": "The cell membrane is a phospholipid bilayer that controls what enters and exits the cell.",
      "marks": 10,
      "threshold": 0.55
    },
    {
      "id": 3,
      "question": "Explain mitosis.",
      "expectedAnswer": "Mitosis is cell division producing two identical daughter cells with the same chromosome count as the parent.",
      "marks": 10,
      "threshold": 0.5
    }
  ]
}`;

export function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">How It Works</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 text-sm text-gray-700 dark:text-gray-300">
          {/* Checking mode explanation */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Checking Mode</h3>
            <p className="mb-3 text-gray-600 dark:text-gray-400">
              Controls how closely a student's answer must match the expected answer to earn marks.
              Select a mode in Step 1 of setup — it applies to all questions equally.
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-16 text-xs font-semibold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-1 rounded-lg text-center">Easy</span>
                <span className="text-gray-700 dark:text-gray-300 text-xs">Flexible — rewards partial understanding. Good for creative or descriptive answers.</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-16 text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-lg text-center">Medium</span>
                <span className="text-gray-700 dark:text-gray-300 text-xs">Balanced — standard grading. Recommended default for most subjects.</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-16 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-2 py-1 rounded-lg text-center">Strict</span>
                <span className="text-gray-700 dark:text-gray-300 text-xs">Precise — close match required. Best for factual or technical answers.</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <p><span className="font-semibold text-gray-700 dark:text-gray-300">Full marks</span> — answer meets or exceeds the similarity target</p>
            <p><span className="font-semibold text-gray-700 dark:text-gray-300">Partial marks</span> — answer is in the right direction but not complete</p>
            <p><span className="font-semibold text-gray-700 dark:text-gray-300">Zero marks</span> — answer is too far from the expected response</p>
          </div>

          {/* JSON format */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Answer Key JSON Format</h3>
            <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs overflow-x-auto text-gray-700 dark:text-gray-300 leading-relaxed">
              {SAMPLE_JSON}
            </pre>
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
