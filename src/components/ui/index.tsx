/**
 * Shared UI primitives — the app's design system.
 * Tokens: zinc neutrals, purple accent, rounded-xl controls, rounded-2xl cards.
 */
import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export { Icon, Caret, type IconName } from './Icon';

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dashed';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-purple-700 text-white hover:bg-purple-800 shadow-sm shadow-purple-700/20',
  secondary: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700',
  ghost: 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20',
  dashed: 'border-2 border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:border-purple-400 dark:hover:border-purple-600 hover:text-purple-700 dark:hover:text-purple-400',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: IconName;
}

export function Button({ variant = 'primary', loading, icon, disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold px-4 py-2.5 transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-950 ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="w-4 h-4" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────────

export const inputClass =
  'w-full border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 transition-shadow focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent';

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
      {children}
      {hint && <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`${inputClass} resize-y ${className}`} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return <select className={`${inputClass} ${className}`} {...rest} />;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Max-width utility class, default max-w-lg */
  size?: string;
}

/** Backdrop + panel with Escape-to-close and click-outside-to-close. */
export function Modal({ onClose, children, size = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full ${size} max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="py-16 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
        <Icon name={icon} className="w-7 h-7 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">{title}</h3>
      {message && <p className="text-sm text-zinc-400 dark:text-zinc-500 max-w-sm mx-auto">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Alert / message boxes ─────────────────────────────────────────────────────

type AlertTone = 'error' | 'warning' | 'info' | 'success';

const ALERT_STYLES: Record<AlertTone, string> = {
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400',
  info: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300',
  success: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400',
};

export function Alert({ tone = 'info', children, className = '' }: { tone?: AlertTone; children: ReactNode; className?: string }) {
  return (
    <div className={`border rounded-xl px-4 py-3 text-sm flex items-start gap-2 ${ALERT_STYLES[tone]} ${className}`}>
      <Icon name={tone === 'success' ? 'circleCheck' : tone === 'info' ? 'info' : 'warning'} className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export function Badge({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${className}`}>
      {children}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
      <div
        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

// ── Type-DELETE confirmation modal ────────────────────────────────────────────

interface ConfirmDeleteProps {
  title: string;
  description: ReactNode;
  note?: string;
  confirmLabel: string;
  input: string;
  onInputChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({ title, description, note, confirmLabel, input, onInputChange, onConfirm, onCancel }: ConfirmDeleteProps) {
  return (
    <Modal onClose={onCancel} size="max-w-sm">
      <div className="p-6">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Icon name="trash" className="w-6 h-6 text-red-500 dark:text-red-400" />
          </div>
        </div>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 text-center mb-1">{title}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-1">{description}</p>
        {note && <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center mb-4">{note}</p>}
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
          Type <span className="font-bold text-red-500">DELETE</span> to confirm
        </p>
        <input
          type="text"
          value={input}
          onChange={e => onInputChange(e.target.value)}
          placeholder="DELETE"
          autoFocus
          className={`${inputClass} font-mono mb-4`}
        />
        <div className="flex gap-3">
          <Button variant="danger" className="flex-1" disabled={input !== 'DELETE'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
