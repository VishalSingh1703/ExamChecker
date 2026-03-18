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
  threshold: number;
}

export interface AnswerKey {
  exam: ExamMeta;
  questions: Question[];
}

export interface OCRResult {
  text: string;
  confidence: number;
  error?: string;
}

export interface SimilarityResult {
  score: number;
  method: 'semantic' | 'keyword';
  error?: string;
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

export interface ExamSession {
  answerKey: AnswerKey | null;
  results: QuestionResult[];
  currentQuestionIndex: number;
  activeTab: 'setup' | 'grade' | 'report';
  hfApiKey: string;
}
