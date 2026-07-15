/**
 * Editor card for a single question: text, sub-parts/diagram, AI answer tools
 * (Shorten / Generate / Define), optional keywords, and marks.
 * Shared between Exam Setup (create subject) and the Question Bank.
 */
import type { ReactNode } from 'react';
import type { SubPart } from '../../types';
import { MAX_QUESTION_MARKS } from '../../config/constants';
import { Icon, Spinner, TextArea } from '../../components/ui';
import { SubPartsEditor } from './SubPartsEditor';

export interface EditableQuestion {
  question: string;
  expectedAnswer: string;
  marks: number;
  /** Raw comma-separated keywords text; pass undefined to hide the field. */
  keywords?: string;
  subparts: SubPart[];
  diagram?: string;
}

export type AiBusy = 'generate' | 'shorten' | 'define' | null;

interface Props {
  index: number;
  value: EditableQuestion;
  /** Which AI action is running on THIS card (controls its spinner). */
  busy: AiBusy;
  /** True while any AI action runs anywhere (disables all AI buttons). */
  anyBusy: boolean;
  error?: string;
  keywordWarning?: string;
  showKeywords?: boolean;
  headerExtra?: ReactNode;
  onChange: (patch: Partial<EditableQuestion>) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onRefine: (mode: 'shorten' | 'define') => void;
}

export function QuestionEditorCard({
  index, value, busy, anyBusy, error, keywordWarning, showKeywords, headerExtra,
  onChange, onRemove, onGenerate, onRefine,
}: Props) {
  const marksInvalid = value.marks === 0 || value.marks > MAX_QUESTION_MARKS;

  const aiBtn = (tone: string) =>
    `flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tone}`;

  return (
    <div className="border border-ink-200 dark:border-ink-700 rounded-xl p-4 space-y-3 bg-ink-50/70 dark:bg-ink-800/50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wide">Question {index + 1}</span>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button onClick={onRemove} className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
            Remove
          </button>
        </div>
      </div>

      {/* Question text + subparts */}
      <div>
        <label className="block text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">Question</label>
        <TextArea
          value={value.question}
          onChange={e => onChange({ question: e.target.value })}
          rows={2}
          placeholder="Enter the question…"
        />
        <SubPartsEditor
          subparts={value.subparts}
          diagram={value.diagram}
          onSubpartsChange={subparts => onChange({ subparts })}
          onDiagramChange={diagram => onChange({ diagram })}
        />
      </div>

      {/* Expected answer + AI actions */}
      <div>
        <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
          <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">Expected Answer</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onRefine('shorten')}
              disabled={anyBusy || !value.expectedAnswer.trim()}
              className={aiBtn('bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30')}
            >
              {busy === 'shorten' ? <Spinner className="w-3 h-3" /> : '−'}
              {busy === 'shorten' ? 'Shortening…' : 'Shorten'}
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={anyBusy || !value.question.trim()}
              className={aiBtn('bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 border-accent-200 dark:border-accent-700 hover:bg-accent-100 dark:hover:bg-accent-900/50')}
            >
              {busy === 'generate' ? <Spinner className="w-3 h-3" /> : <Icon name="wand" className="w-3 h-3" />}
              {busy === 'generate' ? 'Generating…' : 'Generate'}
            </button>
            <button
              type="button"
              onClick={() => onRefine('define')}
              disabled={anyBusy || !value.expectedAnswer.trim()}
              className={aiBtn('bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30')}
            >
              {busy === 'define' ? <Spinner className="w-3 h-3" /> : '+'}
              {busy === 'define' ? 'Defining…' : 'Define'}
            </button>
          </div>
        </div>
        <TextArea
          value={value.expectedAnswer}
          onChange={e => onChange({ expectedAnswer: e.target.value })}
          rows={3}
          placeholder="Enter the ideal/expected answer…"
        />
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {/* Keywords (optional field) */}
      {showKeywords && (
        <div>
          <label className="block text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">
            Keywords
            <span className="ml-1.5 font-normal text-ink-400">(optional · comma-separated · must appear in the answer above)</span>
          </label>
          <TextArea
            value={value.keywords ?? ''}
            onChange={e => onChange({ keywords: e.target.value })}
            rows={2}
            className="resize-none"
            placeholder="e.g. photosynthesis, chlorophyll, glucose"
          />
          {keywordWarning && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Not found in expected answer: <span className="font-medium">{keywordWarning}</span>
            </p>
          )}
        </div>
      )}

      {/* Marks */}
      <div>
        <label className="block text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">Marks</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value.marks === 0 ? '' : String(value.marks)}
          onChange={e => {
            const raw = e.target.value.replace(/[^0-9]/g, '');
            onChange({ marks: raw === '' ? 0 : parseInt(raw, 10) });
          }}
          placeholder={`1–${MAX_QUESTION_MARKS}`}
          className={`w-24 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600 focus:border-transparent bg-white dark:bg-ink-800 text-ink-800 dark:text-ink-200 ${
            marksInvalid ? 'border-red-400 dark:border-red-600' : 'border-ink-200 dark:border-ink-700'
          }`}
        />
        {value.marks === 0 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Marks are required.</p>}
        {value.marks > MAX_QUESTION_MARKS && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Marks cannot exceed {MAX_QUESTION_MARKS}.</p>}
      </div>
    </div>
  );
}

/** "Generate All Answers" dashed button used above/below question lists. */
export function GenerateAllButton({ missing, busy, disabled, onClick }: {
  missing: number;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || missing === 0}
      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-accent-300 dark:border-accent-700 text-accent-600 dark:text-accent-400 text-xs font-semibold hover:bg-accent-50 dark:hover:bg-accent-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {busy
        ? <><Spinner className="w-3.5 h-3.5" />Generating all answers…</>
        : `Generate All Answers${missing > 0 ? ` (${missing} missing)` : ''}`}
    </button>
  );
}
