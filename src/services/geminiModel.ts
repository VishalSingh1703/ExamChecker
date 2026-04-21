/** Single source of truth for the Gemini model ID used across all API calls. */
export const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

export function geminiUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}
