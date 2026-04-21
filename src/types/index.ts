export interface SubPart {
  id: string;
  label: string; // 'a', 'b', 'c', ...
  question: string;
}

export interface ExamMeta {
  title: string;
  subject: string;
  totalMarks: number;
}

export interface Question {
  id: number;
  question: string;
  expectedAnswer: string;
  marks: number;
  threshold?: number; // legacy — no longer used for scoring; kept for backwards compat with saved JSON
  keywords?: string[];
  subparts?: SubPart[];
  diagram?: string;
}

export interface AnswerKey {
  exam: ExamMeta;
  questions: Question[];
}

export interface OCRResult {
  text: string;
  confidence: number;
}

export interface SimilarityResult {
  score: number;
  method: 'semantic' | 'keyword';
  error?: string; // set when all semantic APIs failed; indicates keyword fallback was used
}

export interface QuestionResult {
  questionId: number;
  extractedText: string;
  similarityScore: number;
  similarityMethod: 'semantic' | 'keyword';
  marksAwarded: number;
  maxMarks: number;
  status: 'full' | 'partial' | 'zero' | 'skipped';
}

export type CheckingMode = 'easy' | 'medium' | 'strict';

export interface SavedSubjectQuestion {
  id: number;
  question: string;
  expectedAnswer: string;
  marks: number;
  keywords?: string[];
  subparts?: SubPart[];
  diagram?: string;
}

export interface SavedSubject {
  id: string;
  name: string;
  examClass: string;
  questions: SavedSubjectQuestion[];
}

export interface HistoryRecord {
  id: string;
  savedAt: string;
  examTitle: string;
  subject: string;
  term: string;
  examClass: string;
  studentName: string;
  studentSection: string;
  studentId?: string;
  checkingMode: CheckingMode;
  scored: number;
  total: number;
  percentage: number;
  grade: string;
  questions: Question[];
  results: QuestionResult[];
}

export interface ExamSession {
  answerKey: AnswerKey | null;
  results: QuestionResult[];
  activeTab: 'setup' | 'grade' | 'report' | 'history' | 'admin' | 'analytics' | 'question-bank' | 'question-paper';
  hfApiKey: string;
  geminiApiKey: string;
  checkingMode: CheckingMode;
  examTerm: string;
  examClass: string;
  studentName: string;
  studentSection: string;
  studentId: string;
  sessionId: string;
}
