import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { hasSupabase } from "./db";
import { embed, hasEmbeddingProvider } from "./embeddings";

export type KbKind = "runbook" | "postmortem" | "service" | "architecture" | "other";

export type RetrievedChunk = {
  chunk_id: string;
  document_id: string;
  text: string;
  similarity: number;
  document_title: string | null;
  document_kind: KbKind | string;
  source_path: string;
};

export type RetrieveResult = {
  mode: "vector" | "trigram" | "none";
  chunks: RetrievedChunk[];
};

/**
 * Chunk markdown by paragraphs while staying under ~`maxChars`.
 * Splits on blank lines (preserving structure) and greedily packs into
 * chunks, with a small overlap (last N chars of previous chunk).
 *
 * Why not split on tokens? Char-based is simpler, deterministic across
 * runs, and we use a generous safety margin under the 8191-token limit.
 */
export function chunkMarkdown(text: string, opts: { maxChars?: number; overlapChars?: number } = {}): string[] {
  const maxChars = opts.maxChars ?? 1500;
  const overlapChars = opts.overlapChars ?? 150;
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf.length + p.length + 2 <= maxChars) {
      buf = buf ? buf + "\n\n" + p : p;
      continue;
    }
    if (buf) chunks.push(buf);
    if (p.length > maxChars) {
      // Single paragraph too big — hard split
      for (let i = 0; i < p.length; i += maxChars - overlapChars) {
        chunks.push(p.slice(i, i + maxChars));
      }
      buf = "";
    } else {
      // Start next buf with overlap tail from previous chunk
      const tail = buf.slice(-overlapChars);
      buf = (tail ? tail + "\n\n" : "") + p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Idempotent upsert of a document + its chunks.
 * - If content_hash matches, no-op (skip re-embedding to save tokens)
 * - Otherwise delete old chunks, insert new ones with embeddings (when provider available)
 */
export async function ingestDocument(input: {
  source_path: string;
  kind: KbKind;
  title?: string;
  raw_text: string;
}): Promise<{ document_id: string; chunks_written: number; skipped: boolean }> {
  if (!hasSupabase()) throw new Error("Supabase not configured");
  const sb = supabaseAdmin();
  const hash = hashContent(input.raw_text);

  const { data: existing } = await sb
    .from("kb_documents")
    .select("id, content_hash")
    .eq("source_path", input.source_path)
    .maybeSingle();

  if (existing && existing.content_hash === hash) {
    return { document_id: existing.id, chunks_written: 0, skipped: true };
  }

  // Upsert document
  const { data: doc, error: e1 } = await sb
    .from("kb_documents")
    .upsert(
      {
        id: existing?.id,
        source_path: input.source_path,
        kind: input.kind,
        title: input.title ?? null,
        content_hash: hash,
        raw_text: input.raw_text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_path" }
    )
    .select("id")
    .single();
  if (e1) throw e1;

  // Delete old chunks (cascade off — explicit)
  await sb.from("kb_chunks").delete().eq("document_id", doc.id);

  // Chunk + embed + insert
  const chunks = chunkMarkdown(input.raw_text);
  const rows: Array<{
    document_id: string;
    chunk_index: number;
    text: string;
    embedding: number[] | null;
    signature: string;
    token_count: number;
  }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const embedding = await embed(text);
    rows.push({
      document_id: doc.id,
      chunk_index: i,
      text,
      embedding,
      signature: text,
      token_count: Math.ceil(text.length / 4), // rough heuristic
    });
  }
  if (rows.length > 0) {
    // supabase-js wants embeddings as strings for vector(...) columns
    const formatted = rows.map((r) => ({
      ...r,
      embedding: r.embedding ? (r.embedding as unknown as string) : null,
    }));
    const { error: e2 } = await sb.from("kb_chunks").insert(formatted);
    if (e2) throw e2;
  }
  return { document_id: doc.id, chunks_written: rows.length, skipped: false };
}

/**
 * Retrieve top-k KB chunks similar to the query.
 * Same fallback chain as similar.ts: pgvector if embedding provider available,
 * pg_trgm otherwise.
 */
export async function retrieveContext(
  queryText: string,
  opts: { limit?: number; vectorThreshold?: number; trigramThreshold?: number } = {},
): Promise<RetrieveResult> {
  if (!hasSupabase()) return { mode: "none", chunks: [] };
  const sb = supabaseAdmin();
  const limit = opts.limit ?? 5;
  const vt = opts.vectorThreshold ?? 0.35;
  const tt = opts.trigramThreshold ?? 0.05; // chunks are longer than incident signatures → looser

  if (hasEmbeddingProvider()) {
    const vec = await embed(queryText);
    if (vec) {
      const { data, error } = await sb.rpc("match_kb_chunks_by_embedding", {
        query_embedding: vec,
        match_threshold: vt,
        match_count: limit,
      });
      if (!error && data) return { mode: "vector", chunks: data as RetrievedChunk[] };
    }
  }

  const { data, error } = await sb.rpc("match_kb_chunks_by_signature", {
    query_text: queryText,
    match_threshold: tt,
    match_count: limit,
  });
  if (error || !data) return { mode: "trigram", chunks: [] };
  return { mode: "trigram", chunks: data as RetrievedChunk[] };
}

/**
 * Persist which chunks were used for an analysis (audit trail).
 */
export async function recordRetrievedChunks(analysisId: string, chunks: RetrievedChunk[]) {
  if (!hasSupabase() || chunks.length === 0) return;
  const sb = supabaseAdmin();
  await sb.from("analysis_kb_chunks").insert(
    chunks.map((c, i) => ({
      analysis_id: analysisId,
      chunk_id: c.chunk_id,
      similarity: c.similarity,
      rank: i,
    })),
  );
}

/**
 * Format retrieved chunks as a markdown block to inject into the LLM prompt.
 */
export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  const blocks = chunks.map((c, i) => {
    const header = c.document_title || c.source_path;
    return `[${i + 1}] ${header} (${c.document_kind})\n${c.text}`;
  });
  return `

# Internal context (retrieved from knowledge base)

Use these excerpts from internal runbooks / postmortems / service docs to ground your response in this organization's actual systems. Reference specific sources by their bracket number, e.g. "as documented in [2]". If the excerpts contradict generic advice, prefer them — they reflect company practice.

${blocks.join("\n\n---\n\n")}`;
}
