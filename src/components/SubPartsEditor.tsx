import { useRef } from 'react';
import type { SubPart } from '../types';

function indexToLabel(n: number): string {
  return String.fromCharCode(97 + n); // a, b, c, ...
}

interface Props {
  subparts: SubPart[];
  diagram?: string;
  onSubpartsChange: (subparts: SubPart[]) => void;
  onDiagramChange: (diagram: string | undefined) => void;
}

export function SubPartsEditor({ subparts, diagram, onSubpartsChange, onDiagramChange }: Props) {
  const diagramRef = useRef<HTMLInputElement>(null);

  function addSubpart() {
    const sp: SubPart = { id: crypto.randomUUID(), label: indexToLabel(subparts.length), question: '' };
    onSubpartsChange([...subparts, sp]);
  }

  function updateSubpart(id: string, question: string) {
    onSubpartsChange(subparts.map(sp => sp.id === id ? { ...sp, question } : sp));
  }

  function removeSubpart(id: string) {
    const remaining = subparts.filter(sp => sp.id !== id);
    onSubpartsChange(remaining.map((sp, i) => ({ ...sp, label: indexToLabel(i) })));
  }

  function handleDiagramUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onDiagramChange(reader.result as string);
    reader.readAsDataURL(file);
    if (diagramRef.current) diagramRef.current.value = '';
  }

  return (
    <div className="space-y-2 mt-2">
      {subparts.map(sp => (
        <div key={sp.id} className="flex items-start gap-2">
          <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 mt-2.5 w-4 shrink-0">{sp.label}.</span>
          <textarea
            value={sp.question}
            onChange={e => updateSubpart(sp.id, e.target.value)}
            placeholder={`Sub-part ${sp.label}…`}
            rows={2}
            className="flex-1 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 resize-none bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 placeholder-slate-300 dark:placeholder-zinc-600"
          />
          <button
            onClick={() => removeSubpart(sp.id)}
            className="mt-2 text-slate-300 dark:text-zinc-600 hover:text-red-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {diagram && (
        <div className="relative inline-block">
          <img src={diagram} alt="Diagram" className="max-h-32 rounded-xl border border-slate-200 dark:border-zinc-700 object-contain" />
          <button
            onClick={() => onDiagramChange(undefined)}
            className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={addSubpart}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 text-xs font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors border border-slate-200 dark:border-zinc-700"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          +Subpart
        </button>
        {!diagram && (
          <button
            onClick={() => diagramRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 text-xs font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors border border-slate-200 dark:border-zinc-700"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            +Diagram
          </button>
        )}
        <input ref={diagramRef} type="file" accept="image/*" className="hidden" onChange={handleDiagramUpload} />
      </div>
    </div>
  );
}
