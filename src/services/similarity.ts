import type { SimilarityResult } from '../types';

// ── Keyword fallback ──────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'for',
  'of', 'and', 'or', 'but', 'with', 'by', 'from', 'as', 'be',
  'was', 'are', 'were', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'shall', 'that', 'this', 'these', 'those', 'which',
  'who', 'whom', 'whose', 'what', 'when', 'where', 'why', 'how',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

export function keywordOverlapScore(extracted: string, expected: string): number {
  const a = tokenize(extracted);
  const b = tokenize(expected);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = new Set([...a].filter((t) => b.has(t)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

// ── Gemini meaning-match (primary) ───────────────────────────────────────────

async function getGeminiScore(extracted: string, expected: string, apiKey: string, keywords: string[]): Promise<number> {
  const keywordNote = keywords.length > 0
    ? `\nCritical keywords the student must include: ${keywords.join(', ')}.\nIf ALL keywords are present and used correctly: score can reach 1.0.\nIf keywords are present but in wrong context: partial credit only.\nIf ANY keyword is missing: cap the score at 0.5 maximum.`
    : '';

  const prompt = `You are an exam grader evaluating a student's answer.

Expected answer: "${expected}"
Student's answer: "${extracted}"${keywordNote}

Rate how correctly and completely the student's answer matches the MEANING of the expected answer.
- 1.0 = correct and complete answer (minor spelling/grammar errors are fine)
- 0.6–0.9 = mostly correct but missing some detail
- 0.3–0.6 = partially correct, captures some key ideas
- 0.0–0.3 = wrong, irrelevant, or mostly random/nonsense content

Important: word overlap alone does not make an answer correct. Judge the actual meaning.

Respond with ONLY a single decimal number between 0.0 and 1.0. No explanation, no other text.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 200 },
      }),
    }
  );

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
  const data = await response.json();

  // Concatenate all text parts (thinking models may produce multiple parts)
  const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();

  // Extract the first decimal/integer number from the response
  const match = text.match(/\d+(\.\d+)?/);
  if (!match) throw new Error(`Gemini returned non-numeric: "${text.slice(0, 50)}"`);
  const score = parseFloat(match[0]);
  return Math.max(0, Math.min(1, score));
}

// ── HF sentence-similarity (secondary fallback) ───────────────────────────────

const HF_API_URL =
  'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2';

async function getHFScore(extracted: string, expected: string, apiKey: string): Promise<number> {
  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      inputs: { source_sentence: expected, sentences: [extracted] },
      options: { wait_for_model: true },
    }),
  });

  if (response.status === 429) throw new Error('Rate limit exceeded');
  if (!response.ok) throw new Error(`HF API error: ${response.status}`);

  const data: unknown = await response.json();
  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  if (Array.isArray(data) && typeof (data as unknown[])[0] === 'number') return (data as number[])[0];
  if (typeof data === 'number') return data;
  throw new Error('Unexpected HF response format');
}

// ── Public API ────────────────────────────────────────────────────────────────

// Keyword-weighted fallback: blends Jaccard overlap with keyword presence
function keywordWeightedScore(extracted: string, expected: string, keywords: string[]): number {
  const base = keywordOverlapScore(extracted, expected);
  if (keywords.length === 0) return base;
  const extractedLower = extracted.toLowerCase();
  const matched = keywords.filter(k => extractedLower.includes(k)).length;
  const keywordScore = matched / keywords.length;
  // 50% base Jaccard + 50% keyword presence, capped at 0.5 if any keyword missing
  const blended = base * 0.5 + keywordScore * 0.5;
  return matched < keywords.length ? Math.min(blended, 0.5) : blended;
}

export async function getSemanticSimilarity(
  extracted: string,
  expected: string,
  apiKey?: string,
  keywords: string[] = [],
): Promise<SimilarityResult> {
  if (!extracted.trim()) {
    return { score: 0, method: 'keyword' };
  }

  const geminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
  const hfKey = apiKey || (import.meta.env.VITE_HF_API_KEY as string | undefined) || '';

  // 1. Try Gemini (understands meaning + enforces keyword rules)
  if (geminiKey) {
    try {
      const score = await getGeminiScore(extracted, expected, geminiKey, keywords);
      return { score, method: 'semantic' };
    } catch (err) {
      console.error('[similarity] Gemini failed, trying HF:', err instanceof Error ? err.message : err);
    }
  }

  // 2. Try HF sentence-transformers (no keyword weighting at API level)
  if (hfKey) {
    try {
      let score = await getHFScore(extracted, expected, hfKey);
      // Apply keyword cap manually
      if (keywords.length > 0) {
        const extractedLower = extracted.toLowerCase();
        const allPresent = keywords.every(k => extractedLower.includes(k));
        if (!allPresent) score = Math.min(score, 0.5);
      }
      return { score: Math.max(0, Math.min(1, score)), method: 'semantic' };
    } catch (err) {
      console.error('[similarity] HF failed, using keyword fallback:', err instanceof Error ? err.message : err);
    }
  }

  // 3. Keyword-weighted overlap (last resort)
  return {
    score: keywordWeightedScore(extracted, expected, keywords),
    method: 'keyword',
    error: 'Semantic APIs unavailable',
  };
}
