import { useRef, useState } from 'react';
import { usePractice, usePracticeDispatch } from '../../context/PracticeContext';
import { extractChapterText } from '../../services/ai/practice';
import { CLASS_OPTIONS, PRACTICE_MAX_FILE_MB } from '../../config/constants';
import { Alert, Button, Card, CardHeader, FieldLabel, Icon, Select, Spinner, TextInput } from '../../components/ui';

export function SourceStep({ apiKey }: { apiKey: string }) {
  const { cls, subject, chapter, phase, error, chapterText, sourceName } = usePractice();
  const dispatch = usePracticeDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<File | null>(null);

  const extracting = phase === 'extracting';

  function pickFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (f.size > PRACTICE_MAX_FILE_MB * 1024 * 1024) {
      dispatch({
        type: 'FAIL',
        payload: `That file is ${(f.size / (1024 * 1024)).toFixed(1)} MB. Keep it under ${PRACTICE_MAX_FILE_MB} MB — split the chapter or upload fewer pages.`,
      });
      return;
    }
    setPending(f);
    dispatch({ type: 'CLEAR_ERROR' });
    // Auto-name the chapter from the filename, like the Question Bank does
    if (!chapter.trim()) {
      const guess = f.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
      dispatch({ type: 'SET_META', payload: { chapter: guess } });
    }
  }

  async function handleExtract() {
    if (!pending || !apiKey) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: 'START_EXTRACT' });
    try {
      const text = await extractChapterText(pending, apiKey, ctrl.signal);
      dispatch({ type: 'EXTRACT_OK', payload: { chapterText: text, sourceName: pending.name } });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      dispatch({ type: 'FAIL', payload: e instanceof Error ? e.message : 'Could not read that chapter.' });
    }
  }

  const ready = cls.trim() && subject.trim() && chapter.trim() && pending;
  const truncated = chapterText.length > 28_000;

  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardHeader
          title="Chapter details"
          subtitle="These label the generated paper and the report."
        />
        <div className="px-5 pb-5 grid sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel>Class</FieldLabel>
            <Select value={cls} onChange={e => dispatch({ type: 'SET_META', payload: { cls: e.target.value } })}>
              <option value="">Select…</option>
              {CLASS_OPTIONS.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Subject</FieldLabel>
            <TextInput
              value={subject}
              onChange={e => dispatch({ type: 'SET_META', payload: { subject: e.target.value } })}
              placeholder="e.g. Biology"
            />
          </div>
          <div>
            <FieldLabel>Chapter</FieldLabel>
            <TextInput
              value={chapter}
              onChange={e => dispatch({ type: 'SET_META', payload: { chapter: e.target.value } })}
              placeholder="e.g. Cell Structure"
            />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Chapter file"
          subtitle={`PDF, image, or text — up to ${PRACTICE_MAX_FILE_MB} MB. We read the whole chapter once and cache it.`}
        />

        {extracting ? (
          <div className="px-5 py-10 text-center space-y-3">
            <Spinner className="w-8 h-8 mx-auto text-accent-600 dark:text-accent-400" />
            <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Reading the chapter…</p>
            <p className="text-xs text-ink-400 dark:text-ink-500">
              A large PDF can take up to a minute.
            </p>
          </div>
        ) : !pending ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-3 py-12 px-5 text-ink-400 dark:text-ink-500 hover:text-accent-700 dark:hover:text-accent-400 hover:bg-accent-50/50 dark:hover:bg-accent-900/10 transition-colors"
          >
            <Icon name="document" className="w-10 h-10" strokeWidth={1.5} />
            <div className="text-center">
              <p className="text-sm font-semibold">Tap to upload the chapter</p>
              <p className="text-xs mt-1">One chapter at a time gives the best questions</p>
            </div>
          </button>
        ) : (
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-center gap-3 bg-ink-50 dark:bg-ink-800 rounded-xl px-4 py-3">
              <Icon name="document" className="w-8 h-8 text-accent-600 dark:text-accent-400 flex-shrink-0" strokeWidth={1.5} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100 truncate">{pending.name}</p>
                <p className="text-xs text-ink-400 dark:text-ink-500">{(pending.size / (1024 * 1024)).toFixed(1)} MB</p>
              </div>
              <button
                onClick={() => setPending(null)}
                className="text-ink-400 hover:text-red-500 transition-colors text-sm"
                aria-label="Remove file"
              >✕</button>
            </div>
            <Button className="w-full py-3" icon="wand" onClick={handleExtract} disabled={!ready}>
              {ready ? 'Read Chapter' : 'Fill in class, subject and chapter first'}
            </Button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.txt"
          className="hidden"
          onChange={e => { pickFile(e.target.files); e.target.value = ''; }}
        />
      </Card>

      {chapterText && !extracting && (
        <Alert tone={truncated ? 'warning' : 'success'}>
          Read <strong>{chapterText.length.toLocaleString()}</strong> characters from {sourceName}.
          {truncated && ' This may have been truncated — upload one chapter at a time for best results.'}
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
