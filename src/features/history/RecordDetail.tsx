import { useState } from 'react';
import type { HistoryRecord } from '../../types';
import { MODE_LABELS, GRADE_COLORS, STATUS_ROWS } from '../../config/constants';
import { printReport } from '../report/printReport';
import { Badge, Button, Card } from '../../components/ui';

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function RecordDetail({ record }: { record: HistoryRecord }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="space-y-4 animate-fade-in">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-base font-semibold text-ink-900 dark:text-ink-100">{record.examTitle}</h3>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-sm text-ink-500 dark:text-ink-400">
              {record.studentName && <span>{record.studentName}</span>}
              {record.examClass && record.studentSection && <span>{record.examClass} · {record.studentSection}</span>}
              {record.term && <span>{record.term}</span>}
              <span>{formatDate(record.savedAt)}</span>
            </div>
          </div>
          <Badge className={MODE_LABELS[record.checkingMode].badge}>
            {MODE_LABELS[record.checkingMode].label} Checking
          </Badge>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <div className="text-3xl font-bold text-ink-900 dark:text-ink-100">
            {record.scored}<span className="text-ink-400 dark:text-ink-500 text-xl"> / {record.total}</span>
          </div>
          <div className="text-xl font-semibold text-ink-600 dark:text-ink-400">{record.percentage}%</div>
          <span className={`px-3 py-0.5 rounded-full text-lg font-bold ${GRADE_COLORS[record.grade] ?? 'bg-ink-100 dark:bg-ink-800'}`}>{record.grade}</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-ink-100 dark:border-ink-800">
          <h4 className="text-sm font-semibold text-ink-700 dark:text-ink-300">Question Breakdown</h4>
        </div>
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {record.questions.map((q, idx) => {
            const result = record.results.find(r => r.questionId === q.id);
            const status = result?.status ?? 'skipped';
            const expanded = expandedId === q.id;
            return (
              <div key={q.id} className={STATUS_ROWS[status]}>
                <button className="w-full text-left px-5 py-3 flex items-center gap-4" onClick={() => setExpandedId(expanded ? null : q.id)}>
                  <span className="text-xs font-semibold text-ink-400 dark:text-ink-500 w-6">Q{idx + 1}</span>
                  <span className="flex-1 text-sm text-ink-800 dark:text-ink-200 font-medium truncate">{q.question}</span>
                  {result && (
                    <>
                      <span className="text-xs text-ink-500 dark:text-ink-400 w-20 text-right">{Math.round(result.similarityScore * 100)}% sim</span>
                      <span className="text-sm font-semibold w-16 text-right text-ink-800 dark:text-ink-200">{result.marksAwarded} / {q.marks}</span>
                    </>
                  )}
                  {!result && <span className="text-xs text-ink-400 italic">not graded</span>}
                </button>
                {expanded && result && (
                  <div className="px-10 pb-4 space-y-2">
                    {result.extractedText && (
                      <div>
                        <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-0.5">Student's Answer</p>
                        <p className="text-xs font-mono text-ink-700 dark:text-ink-300 whitespace-pre-wrap bg-ink-50 dark:bg-ink-800 rounded-lg px-3 py-2 border border-ink-200 dark:border-ink-700">{result.extractedText}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide mb-0.5">Expected Answer</p>
                      <p className="text-xs font-mono text-ink-700 dark:text-ink-300 whitespace-pre-wrap bg-ink-50 dark:bg-ink-800 rounded-lg px-3 py-2 border border-ink-200 dark:border-ink-700">{q.expectedAnswer}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex gap-3">
        <Button variant="secondary" icon="print" onClick={() => printReport(record)}>
          Print / Save as PDF
        </Button>
      </div>
    </div>
  );
}
