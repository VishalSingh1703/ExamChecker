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

// ── Batch OCR + Grade (single API call for all questions) ────────────────────

export interface BatchQuestionInput {
  id: number;
  question: string;
  expectedAnswer: string;
  keywords: string[];
  marks: number;
  images: File[]; // ordered pages
}

export interface BatchGradeResult {
  questionId: number;
  extractedText: string;
  score: number; // 0.0–1.0
}

export async function extractAndGradeAll(
  questions: BatchQuestionInput[],
  apiKey: string,
): Promise<BatchGradeResult[]> {
  // Build parts array: preamble + per-question header + images + closing instruction
  const preamble = `You are an expert exam grader. For each question below, one or more images of the student's handwritten answer follow (multiple images = multi-page answer; read them in order).

For EACH question you must:
1. Extract the complete handwritten text from ALL its images, correcting obvious OCR errors while preserving the student's intended meaning.
2. Grade using a MARK-SCHEME KEY-POINTS approach:
   a. Identify the distinct scoreable points in the expected answer.
      - For 1–3 mark questions: usually 1–3 key facts or definitions.
      - For 4–7 mark questions: typically 4–7 concepts, causes, or steps.
      - For 8–15 mark questions: major themes/arguments; the mark count is the target but use however many distinct points the expected answer actually contains as your denominator.
   b. For each point, award: 1.0 (correct), 0.5 (partially right or minor error), 0.0 (wrong / absent).
   c. score = (sum of credits) / (number of scoreable points found), capped at 1.0.

Scoring rules you MUST follow:
- Factual errors (swapped terms, reversed cause/effect, wrong names) MUST reduce credit for that specific point — do not overlook them.
- Incompleteness is penalised proportionally: a student who addresses only 2 out of 8 points should score ~0.25, not 0.5+.
- Brevity is NOT penalised: a concise answer covering all key points earns full score.
- Spelling/grammar mistakes are ignored as long as the meaning is clear.
- If keywords are specified: cap the final score at 0.5 if ANY required keyword is absent.`;

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [{ text: preamble }];

  for (const q of questions) {
    const keywordNote = q.keywords.length > 0
      ? `\nRequired keywords (missing any caps score at 0.5): ${q.keywords.join(', ')}`
      : '';
    parts.push({
      text: `\n\n--- QUESTION (questionId: ${q.id}) ---\nQuestion: "${q.question}" [${q.marks} marks — ~${q.marks} distinct scoreable points]\nExpected Answer (full mark scheme): "${q.expectedAnswer}"${keywordNote}\nImages for this question follow:`,
    });
    for (const file of q.images) {
      const base64 = await fileToBase64(file);
      parts.push({ inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } });
    }
  }

  parts.push({
    text: `\n\nReturn ONLY a JSON array — no markdown, no extra text:\n[{"questionId": <number>, "extractedText": "<text>", "score": <0.0-1.0>}, ...]`,
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
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Gemini returned an unexpected response format.');

  const parsed = JSON.parse(match[0]) as { questionId: number; extractedText: string; score: number }[];
  return parsed.map(r => ({
    questionId: r.questionId,
    extractedText: String(r.extractedText ?? '').trim(),
    score: Math.max(0, Math.min(1, Number(r.score) || 0)),
  }));
}

export async function terminateOCRWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
