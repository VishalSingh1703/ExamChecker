import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { AnswerKey, CheckingMode, ExamSession, QuestionResult } from '../types';

type Action =
  | { type: 'SET_ANSWER_KEY'; payload: AnswerKey }
  | { type: 'SET_HF_API_KEY'; payload: string }
  | { type: 'SET_GEMINI_API_KEY'; payload: string }
  | { type: 'SET_CHECKING_MODE'; payload: CheckingMode }
  | { type: 'SET_EXAM_META'; payload: { examTerm: string; examClass: string } }
  | { type: 'SET_STUDENT_INFO'; payload: { studentName: string; studentSection: string } }
  | { type: 'UPDATE_QUESTION_RESULT'; payload: QuestionResult }
  | { type: 'SET_CURRENT_QUESTION'; payload: number }
  | { type: 'SET_ACTIVE_TAB'; payload: ExamSession['activeTab'] }
  | { type: 'RESET_SESSION' };

const initialState: ExamSession = {
  answerKey: null,
  results: [],
  currentQuestionIndex: 0,
  activeTab: 'setup',
  hfApiKey: '',
  geminiApiKey: (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? localStorage.getItem('gemini-api-key') ?? '',
  checkingMode: 'medium',
  examTerm: '',
  examClass: '',
  studentName: '',
  studentSection: '',
  sessionId: '',
};

function examReducer(state: ExamSession, action: Action): ExamSession {
  switch (action.type) {
    case 'SET_ANSWER_KEY':
      return { ...state, answerKey: action.payload, results: [], currentQuestionIndex: 0, sessionId: crypto.randomUUID() };
    case 'SET_HF_API_KEY':
      return { ...state, hfApiKey: action.payload };
    case 'SET_GEMINI_API_KEY':
      return { ...state, geminiApiKey: action.payload };
    case 'SET_CHECKING_MODE':
      return { ...state, checkingMode: action.payload };
    case 'SET_EXAM_META':
      return { ...state, examTerm: action.payload.examTerm, examClass: action.payload.examClass };
    case 'SET_STUDENT_INFO':
      return { ...state, studentName: action.payload.studentName, studentSection: action.payload.studentSection };
    case 'UPDATE_QUESTION_RESULT': {
      const existing = state.results.findIndex(
        (r) => r.questionId === action.payload.questionId
      );
      const results =
        existing >= 0
          ? state.results.map((r, i) => (i === existing ? action.payload : r))
          : [...state.results, action.payload];
      return { ...state, results };
    }
    case 'SET_CURRENT_QUESTION':
      return { ...state, currentQuestionIndex: action.payload };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    case 'RESET_SESSION':
      return { ...initialState, geminiApiKey: state.geminiApiKey };
    default:
      return state;
  }
}

const ExamStateContext = createContext<ExamSession>(initialState);
const ExamDispatchContext = createContext<React.Dispatch<Action>>(() => {});

export function ExamProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(examReducer, initialState);
  return (
    <ExamStateContext.Provider value={state}>
      <ExamDispatchContext.Provider value={dispatch}>
        {children}
      </ExamDispatchContext.Provider>
    </ExamStateContext.Provider>
  );
}

export function useExam() {
  return useContext(ExamStateContext);
}

export function useExamDispatch() {
  return useContext(ExamDispatchContext);
}
