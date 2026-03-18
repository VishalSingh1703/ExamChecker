import Tesseract from 'tesseract.js';
import type { OCRResult } from '../types';

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

export async function extractTextFromImage(
  file: File,
  onProgress?: (progress: number) => void
): Promise<OCRResult> {
  try {
    progressCallback = onProgress ?? null;
    const w = await getWorker();
    const url = URL.createObjectURL(file);
    const result = await w.recognize(url);
    URL.revokeObjectURL(url);
    progressCallback = null;

    const rawText = result.data.text;
    const cleanText = rawText
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();

    return {
      text: cleanText,
      confidence: result.data.confidence,
    };
  } catch (err) {
    progressCallback = null;
    return {
      text: '',
      confidence: 0,
      error: err instanceof Error ? err.message : 'OCR failed',
    };
  }
}

export async function terminateOCRWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
