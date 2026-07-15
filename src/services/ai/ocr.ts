/**
 * OCR: Gemini primary, Tesseract fallback.
 * Tesseract.js is imported dynamically so its ~large worker bundle is only
 * downloaded if the fallback path is actually hit.
 */
import type { OCRResult } from '../../types';
import { callGemini, filePart } from './client';

// ── Gemini OCR (primary) ──────────────────────────────────────────────────────

async function extractTextWithGemini(file: File, apiKey: string): Promise<OCRResult> {
  const text = await callGemini(apiKey, [
    await filePart(file),
    { text: 'Extract all the handwritten text from this image exactly as written. Preserve line breaks and the original structure. Return only the extracted text — no labels, no commentary, no formatting marks.' },
  ]);
  return { text, confidence: 95 };
}

// ── Tesseract fallback (lazy-loaded) ──────────────────────────────────────────

type TesseractWorker = {
  recognize: (url: string) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

let worker: TesseractWorker | null = null;
let progressCallback: ((p: number) => void) | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!worker) {
    const Tesseract = (await import('tesseract.js')).default;
    worker = await Tesseract.createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text' && progressCallback) {
          progressCallback(Math.round(m.progress * 100));
        }
      },
    }) as unknown as TesseractWorker;
  }
  return worker;
}

async function extractTextWithTesseract(
  file: File,
  onProgress?: (p: number) => void,
): Promise<OCRResult> {
  progressCallback = onProgress ?? null;
  const w = await getWorker();
  const url = URL.createObjectURL(file);
  try {
    const result = await w.recognize(url);
    const clean = result.data.text
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();
    return { text: clean, confidence: result.data.confidence };
  } finally {
    URL.revokeObjectURL(url);
    progressCallback = null;
  }
}

export async function terminateOCRWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function extractTextFromImage(
  file: File,
  onProgress?: (progress: number) => void,
  geminiApiKey?: string,
): Promise<OCRResult & { usedGemini: boolean }> {
  if (geminiApiKey?.trim()) {
    try {
      onProgress?.(10);
      const result = await extractTextWithGemini(file, geminiApiKey.trim());
      onProgress?.(100);
      return { ...result, usedGemini: true };
    } catch (err) {
      console.error('[ocr] AI extraction failed, falling back to Tesseract:', err instanceof Error ? err.message : err);
    }
  }
  const fallback = await extractTextWithTesseract(file, onProgress);
  return { ...fallback, usedGemini: false };
}
