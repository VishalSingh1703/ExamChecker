/**
 * Answer-sheet page list: thumbnails, reorder, remove, add-more, and a lightbox.
 *
 * Presentation only. The `SheetPage[]` array and its object-URL lifecycle stay
 * with the owner (see the ref-based revoke pattern in GradingView), because the
 * URLs must be revoked even when this component has already unmounted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SheetPage } from '../services/ai/grading';
import { Icon } from './ui';

interface PageUploaderProps {
  pages: SheetPage[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  /** Copy for the empty state — differs between grading a sheet and sitting a test. */
  emptyTitle?: string;
  emptyHint?: string;
}

export function PageUploader({
  pages,
  onAdd,
  onRemove,
  onMove,
  emptyTitle = 'Tap to upload answer sheet pages',
  emptyHint = 'Select all pages at once · Reorder below if needed',
}: PageUploaderProps) {
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const closeLightbox = useCallback(() => setLightboxPage(null), []);

  useEffect(() => {
    if (lightboxPage === null) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxPage, closeLightbox]);

  // A removed last page would leave the lightbox pointing past the end.
  useEffect(() => {
    if (lightboxPage !== null && lightboxPage >= pages.length) setLightboxPage(null);
  }, [pages.length, lightboxPage]);

  return (
    <>
      {/* ── Lightbox ─────────────────────────────────────────────────────────── */}
      {lightboxPage !== null && pages[lightboxPage] && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center"
          onClick={closeLightbox}
        >
          <div className="relative w-full max-w-3xl px-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={closeLightbox}
              className="absolute -top-10 right-4 text-white text-2xl font-bold hover:text-ink-300"
              aria-label="Close preview"
            >✕</button>
            <img
              src={pages[lightboxPage].url}
              alt={`Page ${lightboxPage + 1}`}
              className="w-full max-h-[82vh] object-contain rounded-xl"
            />
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={() => setLightboxPage(p => p !== null && p > 0 ? p - 1 : p)}
                disabled={lightboxPage === 0}
                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm disabled:opacity-30 hover:bg-white/30"
              >← Prev</button>
              <span className="text-white text-sm">Page {lightboxPage + 1} of {pages.length}</span>
              <button
                onClick={() => setLightboxPage(p => p !== null && p < pages.length - 1 ? p + 1 : p)}
                disabled={lightboxPage === pages.length - 1}
                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm disabled:opacity-30 hover:bg-white/30"
              >Next →</button>
            </div>
          </div>
        </div>
      )}

      {pages.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-3 py-12 px-5 text-ink-400 dark:text-ink-500 hover:text-accent-700 dark:hover:text-accent-400 hover:bg-accent-50/50 dark:hover:bg-accent-900/10 transition-colors"
        >
          <Icon name="image" className="w-10 h-10" strokeWidth={1.5} />
          <div className="text-center">
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-xs mt-1">{emptyHint}</p>
          </div>
        </button>
      ) : (
        <div className="divide-y divide-ink-100 dark:divide-ink-800 max-h-[65vh] overflow-y-auto">
          {pages.map((page, i) => (
            <div key={page.id} className="flex items-start gap-3 px-4 py-3">
              <img
                src={page.url}
                alt={`Page ${i + 1}`}
                onClick={() => setLightboxPage(i)}
                loading="lazy"
                className="w-20 h-24 object-cover rounded-lg border border-ink-200 dark:border-ink-700 cursor-pointer hover:opacity-80 flex-shrink-0"
              />
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Page {i + 1}</p>
                <p className="text-xs text-ink-400 dark:text-ink-500 truncate mt-0.5">{page.file.name}</p>
                <button onClick={() => setLightboxPage(i)} className="text-xs text-accent-600 dark:text-accent-400 hover:underline mt-1">
                  View full size
                </button>
              </div>
              <div className="flex flex-col items-center gap-1 pt-1 flex-shrink-0">
                <button onClick={() => onMove(i, 'up')} disabled={i === 0} title="Move up" aria-label={`Move page ${i + 1} up`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 disabled:opacity-30 hover:bg-ink-200 dark:hover:bg-ink-700 transition-colors">
                  <Icon name="chevronUp" className="w-4 h-4" />
                </button>
                <button onClick={() => onMove(i, 'down')} disabled={i === pages.length - 1} title="Move down" aria-label={`Move page ${i + 1} down`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 disabled:opacity-30 hover:bg-ink-200 dark:hover:bg-ink-700 transition-colors">
                  <Icon name="chevronDown" className="w-4 h-4" />
                </button>
                <button onClick={() => onRemove(i)} title="Remove" aria-label={`Remove page ${i + 1}`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Icon name="x" className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-3 border-t border-ink-100 dark:border-ink-800">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-ink-300 dark:border-ink-600 rounded-lg text-sm text-ink-500 dark:text-ink-400 hover:border-accent-400 dark:hover:border-accent-500 hover:text-accent-700 dark:hover:text-accent-400 transition-colors"
        >
          <Icon name="plus" className="w-4 h-4" />
          {pages.length === 0 ? 'Upload Pages' : 'Add More Pages'}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ''; }}
      />
    </>
  );
}
