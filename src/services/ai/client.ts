/**
 * Single Gemini HTTP client shared by every AI call in the app.
 * The model ID lives here and nowhere else.
 */

export const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

export function geminiUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface GeminiConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Calls Gemini with the given parts and returns the concatenated text of the
 * first candidate. Throws with the API's own error message on failure.
 */
export async function callGemini(
  apiKey: string,
  parts: GeminiPart[],
  config: GeminiConfig = {},
  signal?: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new Error('No AI API key configured. Add one in Setup → Advanced Settings.');

  const response = await fetch(geminiUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, ...config },
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message ?? `AI API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const textParts = data.candidates?.[0]?.content?.parts ?? [];
  return textParts.map(p => p.text ?? '').join('').trim();
}

/** Reads a File as a raw base64 string (no data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader produced unexpected result type'));
        return;
      }
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('FileReader result missing base64 separator'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

/** Builds an image/PDF inline part for a File. */
export async function filePart(file: File, fallbackMime = 'image/jpeg'): Promise<GeminiPart> {
  return { inlineData: { mimeType: file.type || fallbackMime, data: await fileToBase64(file) } };
}

/**
 * Extracts the first balanced JSON object `{…}` or array `[…]` from a string
 * that may contain surrounding markdown fences or prose. Depth-based rather
 * than a greedy regex so nested braces cannot mis-match.
 */
export function extractJson(raw: string, kind: 'object' | 'array'): string {
  const open = kind === 'object' ? '{' : '[';
  const close = kind === 'object' ? '}' : ']';
  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === close) {
      depth--;
      if (depth === 0 && start !== -1) {
        return raw.slice(start, i + 1);
      }
    }
  }
  throw new Error(`No JSON ${kind} found in AI response`);
}
