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
