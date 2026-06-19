import OpenAI from "openai";
import { safeErrorDetail } from "./observability";

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims, $0.02 / 1M tokens

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export function hasEmbeddingProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Compute a 1536-dim embedding for the given text.
 * Returns null if no embedding provider is configured (caller should fall back
 * to trigram search). Returns null on transient error too — caller should
 * never crash on embedding failures, similar-incident search is best-effort.
 */
export async function embed(text: string): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const trimmed = text.slice(0, 8000); // 8000-char safety margin under 8191 token limit
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: trimmed });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[embed] failed:", safeErrorDetail(err));
    return null;
  }
}

/**
 * Build the text we embed + index for trigram search.
 * Includes service, symptoms, summary, severity — the high-signal fields.
 * Deliberately excludes raw_context (too noisy; logs/timestamps would dominate).
 */
export function buildSignature(input: {
  title?: string | null;
  service?: string | null;
  symptoms?: string | null;
  summary?: string | null;
  severity?: string | null;
}): string {
  return [input.title, input.service, input.symptoms, input.severity, input.summary]
    .filter(Boolean)
    .join(" · ");
}
