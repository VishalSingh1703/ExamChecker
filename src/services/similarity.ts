import type { SimilarityResult } from '../types';

const HF_API_URL =
  'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2';

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

async function callHFApi(
  extracted: string,
  expected: string,
  apiKey?: string
): Promise<number> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body = JSON.stringify({
    inputs: {
      source_sentence: expected,
      sentences: [extracted],
    },
  });

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers,
    body,
  });

  if (response.status === 503) {
    // Model loading — retry once after 10 seconds
    await new Promise((r) => setTimeout(r, 10000));
    const retry = await fetch(HF_API_URL, {
      method: 'POST',
      headers,
      body,
    });
    if (!retry.ok) throw new Error(`HF API error: ${retry.status}`);
    const retryData = await retry.json();
    return Array.isArray(retryData) ? retryData[0] : retryData;
  }

  if (response.status === 429) {
    throw new Error('RATE_LIMIT');
  }

  if (!response.ok) {
    throw new Error(`HF API error: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function getSemanticSimilarity(
  extracted: string,
  expected: string,
  apiKey?: string
): Promise<SimilarityResult> {
  if (!extracted.trim()) {
    return { score: 0, method: 'keyword' };
  }

  try {
    const score = await callHFApi(extracted, expected, apiKey);
    return { score: Math.max(0, Math.min(1, score)), method: 'semantic' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const fallbackScore = keywordOverlapScore(extracted, expected);
    return {
      score: fallbackScore,
      method: 'keyword',
      error: message,
    };
  }
}
