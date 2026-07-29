/**
 * Practice-test AI: turn a chapter file into a question paper with model answers.
 *
 * Two stages, deliberately separate:
 *   1. extractChapterText  — file → plain prose. Cached by the caller, so
 *      regenerating a paper never re-uploads the PDF.
 *   2. generatePracticePaper — cached prose + a blueprint → questions + answers.
 *
 * Stage 1 returns prose rather than JSON, so it cannot fail on malformed output.
 */
import { callGemini, extractJson, filePart, fileToBase64 } from './client';

// ── Blueprint ─────────────────────────────────────────────────────────────────

export interface BlueprintRow {
  id: string;
  count: number;
  marks: number;
}

export interface GeneratedQuestion {
  question: string;
  expectedAnswer: string;
  marks: number;
  keywords: string[];
}

export function blueprintTotals(rows: BlueprintRow[]): { questions: number; marks: number } {
  let questions = 0;
  let marks = 0;
  for (const r of rows) {
    const c = Math.max(0, Math.floor(r.count) || 0);
    questions += c;
    marks += c * (Math.max(0, Math.floor(r.marks) || 0));
  }
  return { questions, marks };
}

/**
 * Flattens the blueprint into one mark value per question slot.
 * Small models drift on multiplicative counts ("5 questions of 2 marks") but
 * follow an explicitly enumerated list reliably.
 */
export function expandSlots(rows: BlueprintRow[]): number[] {
  const slots: number[] = [];
  for (const r of rows) {
    const c = Math.max(0, Math.floor(r.count) || 0);
    const m = Math.max(1, Math.floor(r.marks) || 1);
    for (let i = 0; i < c; i++) slots.push(m);
  }
  return slots.sort((a, b) => a - b);
}

// ── Stage 1: chapter → text ───────────────────────────────────────────────────

const EXTRACT_TEXT_PROMPT = `Transcribe the complete study content of this chapter as continuous plain text.

Preserve every heading, definition, formula, numbered list, table content, and worked example.
Omit page numbers, running headers and footers, publisher marks, and exercise answer keys.
Do not summarise. Do not add commentary or your own headings.

Return ONLY the transcribed text.`;

/** Hard ceiling on cached text, so localStorage persistence stays sane. */
const MAX_CHAPTER_CHARS = 60_000;

export async function extractChapterText(
  file: File,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const name = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  const isTxt = file.type === 'text/plain' || name.endsWith('.txt');

  let text: string;
  if (isTxt) {
    text = (await file.text()).trim();
  } else {
    // Mobile pickers often hand back an empty file.type, so the PDF mime is
    // hardcoded here rather than read off the File (same as authoring.ts).
    const part = isPdf
      ? { inlineData: { mimeType: 'application/pdf', data: await fileToBase64(file) } }
      : await filePart(file);
    text = await callGemini(
      apiKey,
      [part, { text: EXTRACT_TEXT_PROMPT }],
      { temperature: 0, maxOutputTokens: 8192 },
      signal,
    );
  }

  if (!text.trim()) {
    throw new Error('Could not read any text from that file. Try a clearer scan, or a text-based PDF.');
  }
  return text.slice(0, MAX_CHAPTER_CHARS);
}

// ── Stage 2: text + blueprint → questions with answers ────────────────────────

/** Chapter text sent per generation call — keeps the request well inside limits. */
const MAX_PROMPT_CHARS = 40_000;

function depthGuidance(): string {
  // Mirrors the bands in authoring.ts:generateModelAnswer so practice answers
  // read the same as bank answers.
  return `- 1–2 marks: 1-2 short sentences, simple vocabulary
- 3–5 marks: 3-5 sentences with key terms, moderate detail
- 6+ marks: detailed paragraphs, technical terminology, examples`;
}

function buildPaperPrompt(
  slots: number[],
  examClass: string,
  subject: string,
  chapter: string,
  chapterText: string,
): string {
  const slotTable = slots.map((m, i) => ` ${i + 1}. ${m} mark${m !== 1 ? 's' : ''}`).join('\n');
  const totalMarks = slots.reduce((a, b) => a + b, 0);

  return `You are an expert ${examClass} teacher setting a practice test on "${subject} — ${chapter}".

SLOTS — produce exactly one object per slot, in this exact order:
${slotTable}
Total: ${slots.length} question${slots.length !== 1 ? 's' : ''}, ${totalMarks} marks.

RULES:
- Every question MUST be answerable solely from the chapter text below.
- Cover distinct topics. Never ask the same thing twice and never rephrase an earlier question.
- Scale the depth of each expectedAnswer to that slot's marks:
${depthGuidance()}
- "keywords": 2-4 short technical terms that MUST appear verbatim, character-for-character, inside your own "expectedAnswer" for that question. If you cannot find such terms, return an empty array.

Return a JSON array of exactly ${slots.length} objects, each shaped:
{"question": "...", "expectedAnswer": "...", "keywords": ["...", "..."], "marks": <number>}

Return ONLY the JSON array — no other text, no markdown, no code fences.

---CHAPTER TEXT---
${chapterText.slice(0, MAX_PROMPT_CHARS)}
---END---`;
}

function coerceGenerated(raw: string, slots: number[]): GeneratedQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(extractJson(raw, 'array'));
  }
  if (!Array.isArray(parsed)) {
    throw new Error('The AI did not return a question list. Tap Regenerate.');
  }

  const out: GeneratedQuestion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const question = String(obj.question ?? '').trim();
    const expectedAnswer = String(obj.expectedAnswer ?? '').trim();
    if (!question || !expectedAnswer) continue;

    // The model's own keywords are NOT trusted. grading.ts caps a score at 0.5
    // when any listed keyword is missing from the student's answer, so a keyword
    // that isn't even in our own model answer would silently halve every score.
    const answerLower = expectedAnswer.toLowerCase();
    const keywords = (Array.isArray(obj.keywords) ? obj.keywords : [])
      .map(k => String(k).trim())
      .filter(k => k.length > 0 && answerLower.includes(k.toLowerCase()))
      .slice(0, 4);

    out.push({ question, expectedAnswer, keywords, marks: 0 });
  }

  if (out.length < slots.length) {
    throw new Error(
      `The AI returned ${out.length} of ${slots.length} questions. Tap Regenerate, or ask for fewer questions.`,
    );
  }

  // Marks come from the blueprint, never from the model — this makes the paper
  // total arithmetically guaranteed to match what the user asked for.
  return out.slice(0, slots.length).map((q, i) => ({ ...q, marks: slots[i] }));
}

export async function generatePracticePaper(
  input: {
    chapterText: string;
    blueprint: BlueprintRow[];
    examClass: string;
    subject: string;
    chapter: string;
  },
  apiKey: string,
  signal?: AbortSignal,
): Promise<GeneratedQuestion[]> {
  const slots = expandSlots(input.blueprint);
  if (slots.length === 0) throw new Error('Add at least one question to the blueprint.');
  if (!input.chapterText.trim()) throw new Error('No chapter text available. Upload the chapter again.');

  const totalMarks = slots.reduce((a, b) => a + b, 0);
  const prompt = buildPaperPrompt(
    slots,
    input.examClass || 'senior school',
    input.subject || 'the subject',
    input.chapter || 'this chapter',
    input.chapterText,
  );

  const raw = await callGemini(
    apiKey,
    [{ text: prompt }],
    // Variety matters here — Regenerate must produce a genuinely different paper.
    { temperature: 0.4, maxOutputTokens: Math.min(8192, 700 + totalMarks * 60) },
    signal,
  );

  return coerceGenerated(raw, slots);
}
