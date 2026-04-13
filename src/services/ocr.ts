import Tesseract from 'tesseract.js';
import type { OCRResult } from '../types';

// ── Gemini OCR (primary) ─────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // strip "data:image/...;base64," prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractTextWithGemini(file: File, apiKey: string): Promise<OCRResult> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'image/jpeg';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: { mimeType, data: base64 },
            },
            {
              text: 'Extract all the handwritten text from this image exactly as written. Preserve line breaks and the original structure. Return only the extracted text — no labels, no commentary, no formatting marks.',
            },
          ],
        }],
        generationConfig: {
          temperature: 0,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message ?? `Gemini API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  return { text: text.trim(), confidence: 95 };
}

// ── Tesseract fallback ────────────────────────────────────────────────────────

let worker: Tesseract.Worker | null = null;
let progressCallback: ((p: number) => void) | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text' && progressCallback) {
          progressCallback(Math.round(m.progress * 100));
        }
      },
    });
  }
  return worker;
}

async function extractTextWithTesseract(
  file: File,
  onProgress?: (p: number) => void
): Promise<OCRResult> {
  progressCallback = onProgress ?? null;
  const w = await getWorker();
  const url = URL.createObjectURL(file);
  const result = await w.recognize(url);
  URL.revokeObjectURL(url);
  progressCallback = null;

  const clean = result.data.text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();

  return { text: clean, confidence: result.data.confidence };
}

// ── Combined OCR + semantic grade (single Gemini call) ───────────────────────

export interface OcrGradeResult {
  extractedText: string;
  score: number;
  error?: string;
}

export async function extractAndGrade(
  file: File,
  question: string,
  expectedAnswer: string,
  keywords: string[],
  apiKey: string,
  marks = 1,
): Promise<OcrGradeResult> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'image/jpeg';

  const keywordNote = keywords.length > 0
    ? `\nRequired keywords — cap score at 0.5 if ANY keyword is missing: ${keywords.join(', ')}.`
    : '';

  const prompt = `You are an expert exam grader. You will see a handwritten student answer.

Question: "${question}" [${marks} marks]
Expected answer (full mark scheme): "${expectedAnswer}"${keywordNote}

Do TWO things:
1. Extract the handwritten text from the image, correcting obvious OCR/spelling errors while preserving the student's intended meaning.
2. Grade using a KEY-POINTS approach:
   - Identify the ~${marks} distinct scoreable points in the expected answer.
   - For each point: award 1.0 if correct, 0.5 if partially right / minor error, 0.0 if wrong or absent.
   - score = (total credits) / (total points), capped at 1.0.
   - Factual errors (swapped terms, reversed facts) MUST reduce credit for that point.
   - Brevity alone is not penalised — a short answer covering all points earns full score.
   - A long answer with errors still loses credit for each wrong point.

Respond with ONLY valid JSON — no markdown, no extra text:
{"extractedText":"<corrected extracted text>","score":<0.0–1.0>}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message ?? `Gemini API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  // Concatenate all parts (thinking model may emit multiple)
  const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const raw = parts.map(p => p.text ?? '').join('').trim();

  // Extract JSON from the response (may be wrapped in markdown code fences)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Gemini returned non-JSON: "${raw.slice(0, 80)}"`);

  const parsed = JSON.parse(jsonMatch[0]) as { extractedText?: string; score?: number };
  if (typeof parsed.extractedText !== 'string' || typeof parsed.score !== 'number') {
    throw new Error('Gemini JSON missing required fields');
  }

  return {
    extractedText: parsed.extractedText.trim(),
    score: Math.max(0, Math.min(1, parsed.score)),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function extractTextFromImage(
  file: File,
  onProgress?: (progress: number) => void,
  geminiApiKey?: string
): Promise<OCRResult & { usedGemini: boolean }> {
  if (geminiApiKey?.trim()) {
    try {
      onProgress?.(10);
      const result = await extractTextWithGemini(file, geminiApiKey.trim());
      onProgress?.(100);
      return { ...result, usedGemini: true };
    } catch (err) {
      // Fall through to Tesseract with the error attached
      const fallback = await extractTextWithTesseract(file, onProgress);
      return {
        ...fallback,
        usedGemini: false,
        error: `Gemini failed (${err instanceof Error ? err.message : 'unknown'}), using Tesseract fallback.`,
      };
    }
  }

  // No API key — use Tesseract
  const result = await extractTextWithTesseract(file, onProgress);
  return { ...result, usedGemini: false };
}

// ── Segment all pages + grade all questions in one Gemini call ────────────────

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

export async function segmentAndGradeAll(
  pages: SheetPage[],
  questions: SegmentGradeInput[],
  apiKey: string,
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
Correct obvious OCR/spelling errors while preserving the student's intended meaning.

STEP 3 — GRADING (KEY-POINTS METHOD)
For each extracted answer:
  a. Identify the distinct scoreable points in the expected answer.
     - 1–3 mark questions: 1–3 key facts or definitions.
     - 4–7 mark questions: 4–7 concepts, causes, or steps.
     - 8–20 mark questions: major themes/arguments — use however many distinct points the expected answer actually contains as the denominator.
  b. Award per point: 1.0 (correct), 0.5 (partially right / minor error), 0.0 (wrong or absent).
  c. score = (sum of credits) / (number of scoreable points), capped at 1.0.

SCORING RULES you MUST follow:
- Factual errors (swapped terms, reversed cause/effect, wrong names) MUST reduce credit for that specific point.
- Incompleteness is penalised proportionally — a student addressing only 2 of 8 points scores ~0.25.
- Brevity is NOT penalised — a concise correct answer earns full score.
- Spelling/grammar mistakes are ignored if the meaning is clear.
- If required keywords are listed and ANY are absent, cap the final score at 0.5.

The answer sheet pages follow:`;

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [{ text: preamble }];

  for (let i = 0; i < pages.length; i++) {
    parts.push({ text: `\n\n--- PAGE ${i + 1} ---` });
    const base64 = await fileToBase64(pages[i].file);
    parts.push({ inlineData: { mimeType: pages[i].file.type || 'image/jpeg', data: base64 } });
  }

  const questionList = questions.map(q => {
    const kw = q.keywords.length > 0
      ? `, "keywords": [${q.keywords.map(k => `"${k}"`).join(', ')}]`
      : '';
    return `  { "questionId": ${q.id}, "question": "${q.question.replace(/"/g, '\\"')}", "expectedAnswer": "${q.expectedAnswer.replace(/"/g, '\\"')}", "marks": ${q.marks}${kw} }`;
  }).join(',\n');

  parts.push({
    text: `\n\nQUESTIONS TO GRADE:\n[\n${questionList}\n]\n\nReturn ONLY a JSON array — no markdown, no extra text:\n[{"questionId": <number>, "extractedText": "<complete student answer>", "score": <0.0-1.0>, "notFound": <true|false>}, ...]\n\nInclude an entry for EVERY question in the list, even if no answer was found.`,
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message ?? `Gemini API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const rawParts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const raw = rawParts.map(p => p.text ?? '').join('').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Gemini returned an unexpected response format.');

  const parsed = JSON.parse(match[0]) as {
    questionId: number; extractedText: string; score: number; notFound?: boolean;
  }[];
  return parsed.map(r => ({
    questionId: r.questionId,
    extractedText: String(r.extractedText ?? '').trim(),
    score: Math.max(0, Math.min(1, Number(r.score) || 0)),
    notFound: Boolean(r.notFound),
  }));
}

// ── Re-grade from edited text (no OCR, text-only Gemini call) ─────────────────

export interface ReGradeInput {
  id: number;
  question: string;
  expectedAnswer: string;
  keywords: string[];
  marks: number;
  extractedText: string;
}

export interface ReGradeResult {
  questionId: number;
  score: number;
}

export async function gradeExtractedText(
  inputs: ReGradeInput[],
  apiKey: string,
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

SCORING RULES:
- Factual errors MUST reduce credit for that specific point.
- Incompleteness is penalised proportionally.
- Brevity alone is NOT penalised.
- Spelling/grammar ignored if meaning is clear.
- If required keywords are listed and ANY are absent, cap score at 0.5.

Answers to grade:
[
${answersJson}
]

Return ONLY a JSON array — no markdown, no extra text:
[{"questionId": <number>, "score": <0.0-1.0>}, ...]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message ?? `Gemini API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const rawParts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const raw = rawParts.map(p => p.text ?? '').join('').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Gemini returned an unexpected response format.');

  const parsed = JSON.parse(match[0]) as { questionId: number; score: number }[];
  return parsed.map(r => ({
    questionId: r.questionId,
    score: Math.max(0, Math.min(1, Number(r.score) || 0)),
  }));
}

export async function terminateOCRWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
