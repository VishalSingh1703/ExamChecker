import { callGemini, extractJson, filePart, type GeminiPart } from './client';

// ── Batch segmentation + grading (primary grading path) ───────────────────────

export interface SheetPage {
  id: string;
  file: File;
  url: string;
}

export interface SegmentGradeInput {
  id: number;
  question: string;
  expectedAnswer: string;
  keywords: string[];
  marks: number;
}

export interface SegmentGradeResult {
  questionId: number;
  extractedText: string;
  score: number; // 0.0–1.0
  notFound: boolean;
}

const GRADING_RULES = `SCORING RULES you MUST follow:
- Factual errors (swapped terms, reversed cause/effect, wrong names) MUST reduce credit for that specific point.
- Incompleteness is penalised proportionally — a student addressing only 2 of 8 points scores ~0.25.
- Brevity is NOT penalised — a concise correct answer earns full score.
- Spelling/grammar mistakes are ignored if the meaning is clear.
- If required keywords are listed and ANY are absent, cap the final score at 0.5.`;

function questionListJson(questions: SegmentGradeInput[]): string {
  return questions.map(q => {
    const kw = q.keywords.length > 0
      ? `, "keywords": [${q.keywords.map(k => `"${k}"`).join(', ')}]`
      : '';
    return `  { "questionId": ${q.id}, "question": "${q.question.replace(/"/g, '\\"')}", "expectedAnswer": "${q.expectedAnswer.replace(/"/g, '\\"')}", "marks": ${q.marks}${kw} }`;
  }).join(',\n');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Sends all answer-sheet pages plus the question list in ONE Gemini call.
 * The model segments answers by student-written labels (Q1, 1., Ans 1 …),
 * extracts the handwriting, and grades every question with the key-points method.
 */
export async function segmentAndGradeAll(
  pages: SheetPage[],
  questions: SegmentGradeInput[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<SegmentGradeResult[]> {
  const preamble = `You are an expert exam grader processing a student's complete handwritten answer sheet.

The images that follow are consecutive pages of the answer sheet, in order.

YOUR TASK — 3 STEPS:

STEP 1 — SEGMENTATION
Identify each answer by the label the student wrote. Labels may appear as:
"Q1", "Q.1", "1.", "1)", "(1)", "Ans 1", "Answer 1", "Question 1", or simply a number starting a new section.
Collect ALL text for each label until the next label appears. Answers may span across page boundaries.
If a question has sub-parts (a, b, c …), include all sub-part text as part of that question's answer.
If you cannot locate any answer for a question, set "notFound": true for that entry.

STEP 2 — EXTRACTION
For each identified answer, extract the complete handwritten text.
Correct obvious spelling errors while preserving the student's intended meaning.

STEP 3 — GRADING (KEY-POINTS METHOD)
For each extracted answer:
  a. Identify the distinct scoreable points in the expected answer.
     - 1–3 mark questions: 1–3 key facts or definitions.
     - 4–7 mark questions: 4–7 concepts, causes, or steps.
     - 8–20 mark questions: major themes/arguments — use however many distinct points the expected answer actually contains as the denominator.
  b. Award per point: 1.0 (correct), 0.5 (partially right / minor error), 0.0 (wrong or absent).
  c. score = (sum of credits) / (number of scoreable points), capped at 1.0.

${GRADING_RULES}

The answer sheet pages follow:`;

  const parts: GeminiPart[] = [{ text: preamble }];
  for (let i = 0; i < pages.length; i++) {
    parts.push({ text: `\n\n--- PAGE ${i + 1} ---` });
    parts.push(await filePart(pages[i].file));
  }
  parts.push({
    text: `\n\nQUESTIONS TO GRADE:\n[\n${questionListJson(questions)}\n]\n\nReturn ONLY a JSON array — no markdown, no extra text:\n[{"questionId": <number>, "extractedText": "<complete student answer>", "score": <0.0-1.0>, "notFound": <true|false>}, ...]\n\nInclude an entry for EVERY question in the list, even if no answer was found.`,
  });

  const raw = await callGemini(apiKey, parts, { maxOutputTokens: 8192 }, signal);
  const parsed = JSON.parse(extractJson(raw, 'array')) as {
    questionId: number; extractedText: string; score: number; notFound?: boolean;
  }[];
  return parsed.map(r => ({
    questionId: r.questionId,
    extractedText: String(r.extractedText ?? '').trim(),
    score: clamp01(Number(r.score) || 0),
    notFound: Boolean(r.notFound),
  }));
}

// ── Text-only re-grade (after the teacher edits extracted text) ────────────────

export interface ReGradeInput extends SegmentGradeInput {
  extractedText: string;
}

export interface ReGradeResult {
  questionId: number;
  score: number;
}

export async function gradeExtractedText(
  inputs: ReGradeInput[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<ReGradeResult[]> {
  const answersJson = inputs.map(i => {
    const kw = i.keywords.length > 0
      ? `, "keywords": [${i.keywords.map(k => `"${k}"`).join(', ')}]`
      : '';
    return `  { "questionId": ${i.id}, "question": "${i.question.replace(/"/g, '\\"')}", "expectedAnswer": "${i.expectedAnswer.replace(/"/g, '\\"')}", "marks": ${i.marks}, "studentAnswer": "${i.extractedText.replace(/"/g, '\\"').replace(/\n/g, ' ')}"${kw} }`;
  }).join(',\n');

  const prompt = `You are an expert exam grader. Re-grade the following student answers using the KEY-POINTS method.

For each entry:
  a. Identify the distinct scoreable points in the expected answer (~1 point per mark).
  b. Award per point: 1.0 (correct), 0.5 (partially right / minor error), 0.0 (wrong or absent).
  c. score = (sum of credits) / (number of scoreable points), capped at 1.0.

${GRADING_RULES}

Answers to grade:
[
${answersJson}
]

Return ONLY a JSON array — no markdown, no extra text:
[{"questionId": <number>, "score": <0.0-1.0>}, ...]`;

  const raw = await callGemini(apiKey, [{ text: prompt }], { maxOutputTokens: 1024 }, signal);
  const parsed = JSON.parse(extractJson(raw, 'array')) as { questionId: number; score: number }[];
  return parsed.map(r => ({
    questionId: r.questionId,
    score: clamp01(Number(r.score) || 0),
  }));
}
