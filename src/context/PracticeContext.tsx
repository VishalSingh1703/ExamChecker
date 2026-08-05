/**
 * Practice-test session state.
 *
 * Deliberately separate from ExamContext: RESET_SESSION (the Report tab's
 * "New Exam" button) must never be able to destroy a test in progress. The only
 * thing practice reads from ExamContext is the Gemini API key.
 *
 * Lives above the activeTab conditional in App, so switching tabs mid-test
 * doesn't unmount the attempt.
 */
import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react';
import type { CheckingMode, HistoryRecord, Question, QuestionResult } from '../types';
import type { BlueprintRow } from '../services/ai/practice';
import { readJson, storageKeys, writeJson } from '../services/storage';

export type PracticePhase =
  | 'source'      // choosing class/subject/chapter and uploading the file
  | 'extracting'  // stage-1 AI call in flight
  | 'blueprint'   // choosing how many questions at how many marks
  | 'generating'  // stage-2 AI call in flight
  | 'preview'     // paper ready — save, regenerate, or start
  | 'testing'     // timer running
  | 'grading'     // grading call in flight
  | 'report';     // finished

export interface PracticeState {
  phase: PracticePhase;
  cls: string;
  subject: string;
  chapter: string;
  /** Cached so Regenerate and blueprint edits never re-upload the source file. */
  chapterText: string;
  sourceName: string;
  studentName: string;
  blueprint: BlueprintRow[];
  checkingMode: CheckingMode;
  questions: Question[];
  answerMode: 'typed' | 'photo';
  typedAnswers: Record<number, string>;
  durationMin: number;
  /** Epoch ms. Null outside a running test, or once a stale attempt is reopened. */
  deadlineAt: number | null;
  attemptId: string;
  results: QuestionResult[];
  record: HistoryRecord | null;
  error: string;
  /** Set when a persisted write failed, so the user knows answers aren't crash-safe. */
  storageWarning: boolean;
}

export type PracticeAction =
  | { type: 'SET_META'; payload: Partial<Pick<PracticeState, 'cls' | 'subject' | 'chapter' | 'studentName'>> }
  | { type: 'START_EXTRACT' }
  | { type: 'EXTRACT_OK'; payload: { chapterText: string; sourceName: string } }
  | { type: 'FAIL'; payload: string }
  | { type: 'SET_BLUEPRINT'; payload: BlueprintRow[] }
  | { type: 'GO_BLUEPRINT' }
  | { type: 'START_GENERATE' }
  | { type: 'GENERATE_OK'; payload: Question[] }
  | { type: 'SET_MODE'; payload: CheckingMode }
  | { type: 'SET_DURATION'; payload: number }
  | { type: 'SET_ANSWER_MODE'; payload: 'typed' | 'photo' }
  | { type: 'SET_TYPED_ANSWER'; payload: { id: number; text: string } }
  | { type: 'START_TEST' }
  | { type: 'CLEAR_DEADLINE' }
  | { type: 'START_GRADING' }
  | { type: 'GRADING_OK'; payload: { results: QuestionResult[]; record: HistoryRecord } }
  | { type: 'CLEAR_ERROR' }
  | { type: 'STORAGE_WARNING' }
  | { type: 'RESET' };

const DEFAULT_BLUEPRINT: BlueprintRow[] = [
  { id: 'row-1', count: 5, marks: 2 },
  { id: 'row-2', count: 3, marks: 5 },
];

const initialState: PracticeState = {
  phase: 'source',
  cls: '',
  subject: '',
  chapter: '',
  chapterText: '',
  sourceName: '',
  studentName: '',
  blueprint: DEFAULT_BLUEPRINT,
  checkingMode: 'firm',
  questions: [],
  answerMode: 'typed',
  typedAnswers: {},
  durationMin: 30,
  deadlineAt: null,
  attemptId: '',
  results: [],
  record: null,
  error: '',
  storageWarning: false,
};

function reducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case 'SET_META':
      return { ...state, ...action.payload };
    case 'START_EXTRACT':
      return { ...state, phase: 'extracting', error: '' };
    case 'EXTRACT_OK':
      return {
        ...state,
        phase: 'blueprint',
        chapterText: action.payload.chapterText,
        sourceName: action.payload.sourceName,
        error: '',
      };
    case 'FAIL': {
      // Drop back to the phase the user can act from.
      const back: PracticePhase =
        state.phase === 'extracting' ? 'source'
        : state.phase === 'generating' ? 'blueprint'
        : state.phase === 'grading' ? 'testing'
        : state.phase;
      return { ...state, phase: back, error: action.payload };
    }
    case 'SET_BLUEPRINT':
      return { ...state, blueprint: action.payload };
    case 'GO_BLUEPRINT':
      return { ...state, phase: 'blueprint', error: '' };
    case 'START_GENERATE':
      return { ...state, phase: 'generating', error: '' };
    case 'GENERATE_OK':
      return { ...state, phase: 'preview', questions: action.payload, error: '' };
    case 'SET_MODE':
      return { ...state, checkingMode: action.payload };
    case 'SET_DURATION':
      return { ...state, durationMin: action.payload };
    case 'SET_ANSWER_MODE':
      return { ...state, answerMode: action.payload };
    case 'SET_TYPED_ANSWER':
      return {
        ...state,
        typedAnswers: { ...state.typedAnswers, [action.payload.id]: action.payload.text },
      };
    case 'START_TEST':
      return {
        ...state,
        phase: 'testing',
        attemptId: crypto.randomUUID(),
        deadlineAt: Date.now() + state.durationMin * 60_000,
        typedAnswers: {},
        results: [],
        record: null,
        error: '',
      };
    case 'CLEAR_DEADLINE':
      return { ...state, deadlineAt: null };
    case 'START_GRADING':
      return { ...state, phase: 'grading', error: '' };
    case 'GRADING_OK':
      return {
        ...state,
        phase: 'report',
        results: action.payload.results,
        record: action.payload.record,
        deadlineAt: null,
        error: '',
      };
    case 'CLEAR_ERROR':
      return { ...state, error: '' };
    case 'STORAGE_WARNING':
      return { ...state, storageWarning: true };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

const PERSIST_VERSION = 1;
const PERSIST_DEBOUNCE_MS = 800;
/** Beyond this, an unsubmitted attempt is treated as abandoned rather than auto-submitted. */
const STALE_ATTEMPT_MS = 24 * 60 * 60 * 1000;

type Persisted = PracticeState & { v: number };

function loadPersisted(userId: string): PracticeState {
  const raw = readJson<Partial<Persisted> | null>(storageKeys.practice(userId), null);
  if (!raw || raw.v !== PERSIST_VERSION) return initialState;

  const restored: PracticeState = { ...initialState, ...raw, error: '', storageWarning: false };

  // An in-flight fetch cannot survive a reload — drop back to an actionable phase.
  if (restored.phase === 'extracting') {
    restored.phase = 'source';
  } else if (restored.phase === 'generating') {
    restored.phase = 'blueprint';
  } else if (restored.phase === 'grading') {
    restored.phase = 'testing';
    restored.error = 'Submission was interrupted — tap Submit again.';
  }

  // Don't silently auto-submit an attempt abandoned days ago.
  if (
    restored.phase === 'testing' &&
    restored.deadlineAt !== null &&
    Date.now() - restored.deadlineAt > STALE_ATTEMPT_MS
  ) {
    restored.deadlineAt = null;
    restored.error = 'This attempt expired a while ago. Submit what you have, or start a new practice.';
  }

  return restored;
}

function persist(userId: string, state: PracticeState): boolean {
  const payload: Persisted = { ...state, v: PERSIST_VERSION };
  return writeJson(storageKeys.practice(userId), payload);
}

export function clearPersistedPractice(userId: string): void {
  writeJson(storageKeys.practice(userId), null);
}

/**
 * True when a saved session is mid-test (or mid-submission).
 *
 * `activeTab` is not persisted, so a reload always lands on Setup. On mobile,
 * backgrounding the browser routinely gets the tab discarded and reloaded —
 * which made a running test look like it had been wiped, even though the state
 * restores perfectly. App uses this to open straight back onto the test.
 */
export function hasPracticeInProgress(userId: string): boolean {
  const raw = readJson<Partial<Persisted> | null>(storageKeys.practice(userId), null);
  if (!raw || raw.v !== PERSIST_VERSION) return false;
  return (raw.phase === 'testing' || raw.phase === 'grading') && (raw.questions?.length ?? 0) > 0;
}

// ── Provider ──────────────────────────────────────────────────────────────────

const PracticeStateContext = createContext<PracticeState>(initialState);
const PracticeDispatchContext = createContext<React.Dispatch<PracticeAction>>(() => {
  throw new Error('usePracticeDispatch must be used within PracticeProvider');
});

export function PracticeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, userId, loadPersisted);

  // Latest state for the flush paths that fire outside the render cycle
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const warnedRef = useRef(false);
  const flush = useRef(() => {
    const ok = persist(userId, stateRef.current);
    if (!ok && !warnedRef.current && stateRef.current.phase === 'testing') {
      warnedRef.current = true;
      dispatch({ type: 'STORAGE_WARNING' });
    }
  });
  useEffect(() => {
    flush.current = () => {
      const ok = persist(userId, stateRef.current);
      if (!ok && !warnedRef.current && stateRef.current.phase === 'testing') {
        warnedRef.current = true;
        dispatch({ type: 'STORAGE_WARNING' });
      }
    };
  }, [userId]);

  // Debounced write — typing into 25 textareas must not thrash localStorage
  useEffect(() => {
    const t = setTimeout(() => flush.current(), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Phase transitions are worth writing immediately
  useEffect(() => { flush.current(); }, [state.phase]);

  // Backgrounding the tab is the most likely moment to lose work — and on mobile
  // it is often the last code that runs before the tab is discarded, since
  // `beforeunload` does not fire on a discard.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush.current(); };
    const onPageHide = () => flush.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return (
    <PracticeStateContext.Provider value={state}>
      <PracticeDispatchContext.Provider value={dispatch}>
        {children}
      </PracticeDispatchContext.Provider>
    </PracticeStateContext.Provider>
  );
}

export function usePractice() {
  return useContext(PracticeStateContext);
}

export function usePracticeDispatch() {
  return useContext(PracticeDispatchContext);
}
