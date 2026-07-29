import { useExam } from '../../context/ExamContext';
import { usePractice } from '../../context/PracticeContext';
import { resolveGeminiKey } from '../../config/env';
import { Alert, Icon } from '../../components/ui';
import { SourceStep } from './SourceStep';
import { BlueprintEditor } from './BlueprintEditor';
import { PaperPreview } from './PaperPreview';
import { TestRunner } from './TestRunner';
import { PracticeReportView } from './PracticeReportView';

const STEPS = ['Chapter', 'Questions', 'Paper', 'Test', 'Report'] as const;

/** Which step dot is lit for each phase. */
const STEP_INDEX: Record<string, number> = {
  source: 0,
  extracting: 0,
  blueprint: 1,
  generating: 1,
  preview: 2,
  testing: 3,
  grading: 3,
  report: 4,
};

function StepStrip({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                done
                  ? 'bg-accent-700 border-accent-700 text-white'
                  : active
                    ? 'border-accent-700 text-accent-700 dark:text-accent-400 bg-accent-50 dark:bg-accent-900/20'
                    : 'border-ink-300 dark:border-ink-600 text-ink-400'
              }`}
            >
              {done ? <Icon name="check" className="w-3 h-3" strokeWidth={3} /> : i + 1}
            </div>
            <span
              className={`text-xs font-medium ${
                active ? 'text-ink-900 dark:text-ink-100' : 'text-ink-400 dark:text-ink-500'
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="text-ink-300 dark:text-ink-700 text-xs">→</span>}
          </div>
        );
      })}
    </div>
  );
}

export function PracticeView({ userId, userName }: { userId: string; userName: string }) {
  const { geminiApiKey } = useExam();
  const apiKey = resolveGeminiKey(geminiApiKey);
  const { phase, storageWarning } = usePractice();

  const current = STEP_INDEX[phase] ?? 0;

  return (
    <div className="space-y-4">
      <StepStrip current={current} />

      {!apiKey && (
        <Alert tone="warning">
          No AI API key configured. Add one in <strong>Setup → Advanced Settings</strong> to generate a paper.
        </Alert>
      )}

      {storageWarning && (
        <Alert tone="warning">
          Browser storage is full — your answers are <strong>not</strong> being saved as you type. Finish and submit
          without refreshing.
        </Alert>
      )}

      {(phase === 'source' || phase === 'extracting') && <SourceStep apiKey={apiKey} />}
      {(phase === 'blueprint' || phase === 'generating') && <BlueprintEditor apiKey={apiKey} />}
      {phase === 'preview' && <PaperPreview userId={userId} apiKey={apiKey} />}
      {(phase === 'testing' || phase === 'grading') && (
        <TestRunner userId={userId} userName={userName} apiKey={apiKey} />
      )}
      {phase === 'report' && <PracticeReportView userId={userId} />}
    </div>
  );
}
