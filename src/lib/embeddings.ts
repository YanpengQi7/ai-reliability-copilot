import OpenAI from "openai";
import { safeErrorDetail } from "./observability";
import { createProviderDeadline } from "./providerDeadline";

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims, $0.02 / 1M tokens
export const EMBEDDING_TIMEOUT_MS = 10_000;

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export function hasEmbeddingProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Keep the Supabase pgvector type workaround at one persistence boundary. */
export function embeddingForDatabase(embedding?: number[] | null): string | null {
  return embedding ? (embedding as unknown as string) : null;
}

/**
 * Compute a 1536-dim embedding for the given text.
 * Returns null if no embedding provider is configured (caller should fall back
 * to trigram search). Returns null on transient error too — caller should
 * never crash on embedding failures, similar-incident search is best-effort.
 */
export async function embed(text: string, requestSignal?: AbortSignal): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) return null;
  const deadline = createProviderDeadline(requestSignal, EMBEDDING_TIMEOUT_MS);
  try {
    const trimmed = text.slice(0, 8000); // 8000-char safety margin under 8191 token limit
    const res = await client.embeddings.create(
      { model: EMBEDDING_MODEL, input: trimmed },
      {
        signal: deadline.signal,
        timeout: EMBEDDING_TIMEOUT_MS,
        maxRetries: 1,
      },
    );
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[embed] failed:", safeErrorDetail(err), {
      timed_out: deadline.timeoutSignal.aborted,
    });
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
