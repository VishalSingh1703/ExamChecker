import { Button, Modal } from '../../components/ui';

function StepHeading({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 text-xs font-bold flex items-center justify-center flex-shrink-0">{n}</span>
      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{children}</h3>
    </div>
  );
}

export function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">How It Works</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="px-6 py-5 space-y-6 text-sm text-zinc-700 dark:text-zinc-300 overflow-y-auto">
        <div>
          <StepHeading n="1">Set Up the Exam</StepHeading>
          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 pl-8">
            <li>• Enter the exam term (e.g. UT1, Final Term) and select the class.</li>
            <li>• Pick an existing subject from your saved bank, or create a new one by typing questions and expected answers.</li>
            <li>• Set marks per question (max 20). The AI uses the expected answer as the full mark-scheme.</li>
            <li>• Add <span className="font-medium text-zinc-700 dark:text-zinc-300">keywords</span> to any question — the AI will cap the score at 50% if any keyword is missing from the student's answer.</li>
            <li>• Choose a <span className="font-medium text-zinc-700 dark:text-zinc-300">Checking Mode</span> (see below), then enter the student's name and proceed to Grade.</li>
          </ul>
        </div>

        <div>
          <StepHeading n="2">Upload the Answer Sheet</StepHeading>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 pl-8 mb-2">Two ways to upload — pick whichever is faster:</p>
          <div className="pl-8 space-y-2">
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2.5">
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">📷 Images (recommended)</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Photograph each page and upload them in order. You can select all pages at once. Use the ▲ ▼ arrows to reorder if needed.</p>
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2.5">
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">🎥 Video (hands-free)</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Record a slow, steady video flipping through the answer sheet — hold each page still for 1–2 seconds before turning. The app automatically detects each stable page and extracts it as an image.</p>
            </div>
          </div>
        </div>

        <div>
          <StepHeading n="3">How the AI Finds Each Answer</StepHeading>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 pl-8 mb-2">The AI scans every page and looks for question labels written by the student. Any of these formats work:</p>
          <div className="pl-8 flex flex-wrap gap-1.5">
            {['Q1', 'Q.1', '1.', '1)', '(1)', 'Ans 1', 'Answer 1', 'Question 1'].map(l => (
              <span key={l} className="text-xs font-mono bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-md">{l}</span>
            ))}
          </div>
          <p className="text-xs text-zinc-500 pl-8 mt-2">Answers that span multiple pages are joined automatically. Sub-parts (a, b, c…) are included as part of the same question.</p>
        </div>

        <div>
          <StepHeading n="4">Evaluate &amp; Review</StepHeading>
          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 pl-8">
            <li>• Tap <span className="font-medium text-zinc-700 dark:text-zinc-300">Evaluate</span> — a single AI call reads all pages, finds each answer, and grades everything at once.</li>
            <li>• Each question card shows the extracted text and marks awarded. Review what the AI read.</li>
            <li>• If the AI misread a word, <span className="font-medium text-zinc-700 dark:text-zinc-300">edit the text directly</span> in the card and tap <span className="font-medium text-zinc-700 dark:text-zinc-300">Re-evaluate</span> to get a fresh score.</li>
            <li>• If a student left a question blank, use the <span className="font-medium text-zinc-700 dark:text-zinc-300">Mark unanswered</span> panel to skip it — it receives 0 without an AI call.</li>
            <li>• Once all questions look correct, tap <span className="font-medium text-zinc-700 dark:text-zinc-300">Generate Report</span>.</li>
          </ul>
        </div>

        <div>
          <StepHeading n="★">Checking Modes Explained</StepHeading>
          <div className="space-y-2 pl-8">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-14 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded-lg text-center">Easy</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Lenient — a 70% match awards ~80% of marks. Good for descriptive or creative answers where partial understanding deserves credit.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-14 text-xs font-semibold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 px-2 py-1 rounded-lg text-center">Medium</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Linear — marks are directly proportional to how correct the answer is. 60% match → 60% of marks. The recommended default.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-14 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-2 py-1 rounded-lg text-center">Strict</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Demanding — gaps are penalised heavily. A 70% match awards only 40% of marks; below 50% match earns zero. Best for factual or technical subjects.</span>
            </div>
          </div>
        </div>

        <div>
          <StepHeading n="★">Report, History &amp; Analytics</StepHeading>
          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 pl-8">
            <li>• The <span className="font-medium text-zinc-700 dark:text-zinc-300">Report</span> tab shows the total score, grade, and a per-question breakdown. Use the <span className="font-medium text-zinc-700 dark:text-zinc-300">Print / Save PDF</span> button to export.</li>
            <li>• Every completed exam is saved to <span className="font-medium text-zinc-700 dark:text-zinc-300">History</span>, organised by year → class → section → subject. Tap any record to view the full breakdown.</li>
            <li>• <span className="font-medium text-zinc-700 dark:text-zinc-300">Analytics</span> tracks a student's performance across exams and subjects over time.</li>
          </ul>
        </div>

        <div>
          <StepHeading n="★">Question Bank &amp; Paper Builder</StepHeading>
          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 pl-8">
            <li>• The <span className="font-medium text-zinc-700 dark:text-zinc-300">Question Bank</span> lets you save questions by subject and chapter so you can reuse them across exams without re-typing.</li>
            <li>• Upload a photo of a textbook page and the AI extracts questions automatically.</li>
            <li>• The <span className="font-medium text-zinc-700 dark:text-zinc-300">Paper Builder</span> assembles questions from your bank into a printable question paper with one tap.</li>
          </ul>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800">
        <Button className="w-full" onClick={onClose}>Got it</Button>
      </div>
    </Modal>
  );
}
