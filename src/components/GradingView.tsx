import { useExam, useExamDispatch } from '../context/ExamContext';
import { QuestionGrader } from './QuestionGrader';
import type { QuestionResult } from '../types';

export function GradingView() {
  const { answerKey, currentQuestionIndex, hfApiKey, geminiApiKey } = useExam();
  const dispatch = useExamDispatch();

  if (!answerKey) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-16">
        No answer key loaded. Go to Setup first.
      </div>
    );
  }

  const questions = answerKey.questions;
  const total = questions.length;

  if (currentQuestionIndex >= total) {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'report' });
    return null;
  }

  const question = questions[currentQuestionIndex];

  function advance() {
    const next = currentQuestionIndex + 1;
    dispatch({ type: 'SET_CURRENT_QUESTION', payload: next });
    if (next >= total) {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'report' });
    }
  }

  function handleSave(result: QuestionResult) {
    dispatch({ type: 'UPDATE_QUESTION_RESULT', payload: result });
    advance();
  }

  function handleSkip() {
    const skipped: QuestionResult = {
      questionId: question.id,
      extractedText: '',
      similarityScore: 0,
      similarityMethod: 'keyword',
      marksAwarded: 0,
      maxMarks: question.marks,
      status: 'skipped',
    };
    dispatch({ type: 'UPDATE_QUESTION_RESULT', payload: skipped });
    advance();
  }

  const progress = Math.round((currentQuestionIndex / total) * 100);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Progress bar */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 px-5 py-4">
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
          <span>Progress</span>
          <span>{currentQuestionIndex} / {total} completed</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <QuestionGrader
        key={question.id}
        question={question}
        questionNumber={currentQuestionIndex + 1}
        totalQuestions={total}
        hfApiKey={hfApiKey}
        geminiApiKey={geminiApiKey}
        onSave={handleSave}
        onSkip={handleSkip}
      />
    </div>
  );
}
