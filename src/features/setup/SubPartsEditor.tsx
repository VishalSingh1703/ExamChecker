import { useRef } from 'react';
import type { SubPart } from '../../types';
import { Icon } from '../../components/ui';

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
    reader.onload = () => {
      if (typeof reader.result === 'string') onDiagramChange(reader.result);
    };
    reader.readAsDataURL(file);
    if (diagramRef.current) diagramRef.current.value = '';
  }

  return (
    <div className="space-y-2 mt-2">
      {subparts.map(sp => (
        <div key={sp.id} className="flex items-start gap-2">
          <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mt-2.5 w-4 shrink-0">{sp.label}.</span>
          <textarea
            value={sp.question}
            onChange={e => updateSubpart(sp.id, e.target.value)}
            placeholder={`Sub-part ${sp.label}…`}
            rows={2}
            className="flex-1 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-600 resize-none bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600"
          />
          <button
            onClick={() => removeSubpart(sp.id)}
            className="mt-2 text-zinc-300 dark:text-zinc-600 hover:text-red-500 transition-colors"
            aria-label={`Remove sub-part ${sp.label}`}
          >
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
      ))}

      {diagram && (
        <div className="relative inline-block">
          <img src={diagram} alt="Diagram" className="max-h-32 rounded-xl border border-zinc-200 dark:border-zinc-700 object-contain" />
          <button
            onClick={() => onDiagramChange(undefined)}
            className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
            aria-label="Remove diagram"
          >
            <Icon name="x" className="w-3 h-3" strokeWidth={2.5} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={addSubpart}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700"
        >
          <Icon name="plus" className="w-3 h-3" strokeWidth={2.5} />
          Subpart
        </button>
        {!diagram && (
          <button
            onClick={() => diagramRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700"
          >
            <Icon name="image" className="w-3 h-3" />
            Diagram
          </button>
        )}
        <input ref={diagramRef} type="file" accept="image/*" className="hidden" onChange={handleDiagramUpload} />
      </div>
    </div>
  );
}
