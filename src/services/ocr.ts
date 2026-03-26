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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
): Promise<OcrGradeResult> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'image/jpeg';

  const keywordNote = keywords.length > 0
    ? `\nCritical keywords the student must include: ${keywords.join(', ')}. If ANY keyword is missing, cap the score at 0.5 maximum.`
    : '';

  const prompt = `You are an exam grader. You will see a handwritten student answer.

Question: "${question}"
Expected answer: "${expectedAnswer}"${keywordNote}

Do TWO things:
1. Extract the handwritten text from the image, correcting obvious spelling mistakes while preserving the student's intended meaning.
2. Rate how well the extracted text matches the MEANING of the expected answer.

Score guide:
- 1.0 = correct and complete (minor spelling/grammar errors are fine)
- 0.6–0.9 = mostly correct but missing some detail
- 0.3–0.6 = partially correct, captures some key ideas
- 0.0–0.3 = wrong, irrelevant, or mostly nonsense

Important: judge MEANING, not word overlap. "H2O" and "water molecule" mean the same thing.

Respond with ONLY valid JSON in this exact format, nothing else:
{"extractedText":"<the corrected extracted text>","score":<number between 0.0 and 1.0>}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
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

export async function terminateOCRWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
