import { supabaseAdmin } from "./supabase";
import { hasSupabase } from "./db";
import { embed, hasEmbeddingProvider } from "./embeddings";

export type SimilarIncident = {
  id: string;
  title: string | null;
  service: string | null;
  symptoms: string | null;
  similarity: number;
  created_at: string;
};

export type SimilarSearchMode = "vector" | "trigram" | "none";

export type SimilarResult = {
  mode: SimilarSearchMode;
  hits: SimilarIncident[];
};

/**
 * Find incidents similar to the given query text.
 * Strategy:
 *   1. If OPENAI_API_KEY is set → compute embedding + use pgvector cosine search (semantic)
 *   2. Otherwise → use pg_trgm fuzzy match on signature column (lexical)
 *   3. If DB not configured → return mode="none"
 *
 * Thresholds chosen to favor recall over precision on small libraries
 * (we'd rather show a maybe-relevant incident than nothing). Tune up
 * once the library has 100+ incidents.
 */
export async function findSimilarIncidents(
  queryText: string,
  opts: { excludeId?: string; limit?: number; vectorThreshold?: number; trigramThreshold?: number; abortSignal?: AbortSignal } = {},
): Promise<SimilarResult> {
  if (!hasSupabase()) return { mode: "none", hits: [] };
  const sb = supabaseAdmin();
  const excludeId = opts.excludeId ?? null;
  const limit = opts.limit ?? 5;
  const vt = opts.vectorThreshold ?? 0.4;
  const tt = opts.trigramThreshold ?? 0.15;

  if (hasEmbeddingProvider()) {
    const vec = await embed(queryText, opts.abortSignal);
    if (vec) {
      const { data, error } = await sb.rpc("match_incidents_by_embedding", {
        query_embedding: vec,
        match_threshold: vt,
        match_count: limit,
        exclude_id: excludeId,
      });
      if (!error && data) {
        return { mode: "vector", hits: data as SimilarIncident[] };
      }
      // fall through to trigram on error
    }
  }

  const { data, error } = await sb.rpc("match_incidents_by_signature", {
    query_text: queryText,
    match_threshold: tt,
    match_count: limit,
    exclude_id: excludeId,
  });
  if (error || !data) return { mode: "trigram", hits: [] };
  return { mode: "trigram", hits: data as SimilarIncident[] };
}
