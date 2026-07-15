/**
 * AI helpers for authoring content: model answers, answer refinement,
 * question extraction from files, and question generation from photos.
 * Used by Setup, Question Bank, and Paper Builder.
 */
import { callGemini, extractJson, filePart, fileToBase64 } from './client';

// ── Model answer generation ────────────────────────────────────────────────────

export async function generateModelAnswer(
  question: string,
  examClass: string,
  marks: number,
  apiKey: string,
): Promise<string> {
  const prompt = `You are an expert teacher creating a model answer for an exam.

Question: "${question}"
Class/Level: ${examClass}
Marks allocated: ${marks}

Write an ideal expected answer appropriate for a ${examClass} level student.
Guidelines:
- For Class 1–6 or 1–2 marks: 1-2 short sentences, simple vocabulary
- For Class 7–10 or 3–5 marks: 3-5 sentences with key terms, moderate detail
- For Class 11–12 or Semester or 6+ marks: detailed paragraphs, technical terminology, examples
- Write ONLY the answer text. No labels, no "Expected answer:", no formatting markers.`;

  const text = await callGemini(apiKey, [{ text: prompt }], { temperature: 0.3, maxOutputTokens: 600 });
  if (!text) throw new Error('No text returned from AI.');
  return text;
}

// ── Shorten / expand an existing answer ────────────────────────────────────────

export type RefineMode = 'shorten' | 'define';

export async function refineAnswer(
  question: string,
  currentAnswer: string,
  examClass: string,
  marks: number,
  mode: RefineMode,
  apiKey: string,
): Promise<string> {
  const prompt = mode === 'shorten'
    ? `You are an expert teacher. Shorten the following answer to be more concise while keeping every key point.

Question: "${question}"
Class/Level: ${examClass}
Marks allocated: ${marks}
Current answer: "${currentAnswer}"

Remove repetition and filler. Preserve all essential facts and key terms.
Write ONLY the shortened answer. No labels, no formatting markers.`
    : `You are an expert teacher. Expand and enrich the following answer with definitions, examples, and detail appropriate for the class level.

Question: "${question}"
Class/Level: ${examClass}
Marks allocated: ${marks}
Current answer: "${currentAnswer}"

Add relevant explanations and technical vocabulary for ${examClass}. Scale depth to ${marks} mark${marks !== 1 ? 's' : ''}.
Write ONLY the expanded answer. No labels, no formatting markers.`;

  const text = await callGemini(apiKey, [{ text: prompt }], { temperature: 0.3, maxOutputTokens: 800 });
  if (!text) throw new Error('No text returned from AI.');
  return text;
}

// ── Question extraction from image / PDF / text file ──────────────────────────

export interface ExtractedQuestion {
  question: string;
  subparts: string[];
}

const EXTRACT_PROMPT = `Extract every exam or textbook question from the content.
For each question identify if it has sub-parts labeled with letters (a, b, c…) or roman numerals (i, ii, iii…).

Return a JSON array where each element has:
- "question": the main question text (strip leading numbers like "1.", "Q1.", "Q1)")
- "subparts": array of sub-part texts in order (strip their labels like "a.", "(a)", "i." etc.), empty array if none

Example:
[
  {"question": "Define osmosis.", "subparts": []},
  {"question": "Explain the digestive system.", "subparts": ["Describe the role of the stomach.", "What is the function of the small intestine?"]}
]

Return ONLY the JSON array — no other text, no markdown, no code fences.`;

function parseStructuredQuestions(raw: string): ExtractedQuestion[] {
  function toExtracted(arr: unknown[]): ExtractedQuestion[] {
    return arr.map(item => {
      if (typeof item === 'string') return { question: item.trim(), subparts: [] };
      const obj = item as Record<string, unknown>;
      return {
        question: String(obj.question ?? '').trim(),
        subparts: Array.isArray(obj.subparts)
          ? (obj.subparts as unknown[]).map(s => String(s).trim()).filter(Boolean)
          : [],
      };
    }).filter(q => q.question.length > 0);
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return toExtracted(parsed);
  } catch { /* fall through */ }
  try {
    const parsed = JSON.parse(extractJson(raw, 'array'));
    if (Array.isArray(parsed)) return toExtracted(parsed);
  } catch { /* fall through */ }
  // Plain-lines fallback — no subparts
  const lines = raw
    .split('\n')
    .map(l => l.replace(/^\s*(?:\d+[.)]\s*|Q\d+[.):\s]+)/i, '').trim())
    .filter(l => l.length > 4);
  if (lines.length > 0) return lines.map(q => ({ question: q, subparts: [] }));
  throw new Error('Could not extract questions. Try a clearer file or add questions manually.');
}

/** Extracts questions from an image, PDF, or plain-text file. */
export async function extractQuestionsFromFile(file: File, apiKey: string): Promise<ExtractedQuestion[]> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

  let raw: string;
  if (isTxt) {
    const text = await file.text();
    raw = await callGemini(apiKey, [{ text: `${EXTRACT_PROMPT}\n\n---\n${text.slice(0, 8000)}\n---` }], { maxOutputTokens: 4096 });
  } else {
    const part = isPdf
      ? { inlineData: { mimeType: 'application/pdf', data: await fileToBase64(file) } }
      : await filePart(file);
    raw = await callGemini(apiKey, [part, { text: EXTRACT_PROMPT }], { maxOutputTokens: 4096 });
  }
  return parseStructuredQuestions(raw);
}

// ── Question generation from a textbook photo (Paper Builder) ─────────────────

export async function generateQuestionFromImage(file: File, marks: number, apiKey: string): Promise<string> {
  const marksHint =
    marks <= 2 ? 'a short recall or definition question (1–2 sentences answer)'
    : marks <= 5 ? 'an explanation or analysis question (3–5 sentence answer)'
    : 'a detailed essay or multi-part question (paragraph-length answer)';

  const raw = await callGemini(apiKey, [
    await filePart(file),
    { text: `You are an expert teacher. Read the textbook paragraph in this image and generate exactly ONE exam question worth ${marks} mark${marks !== 1 ? 's' : ''}.
The question should require ${marksHint}.
Return ONLY the question text — no numbering, no answer, no explanation.` },
  ], { temperature: 0.4, maxOutputTokens: 256 });
  return raw.replace(/^["']|["']$/g, '').trim();
}
