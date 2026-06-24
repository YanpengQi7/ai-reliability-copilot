import { embeddingForDatabase } from "./embeddings";

export type IncidentRecordInput = {
  title?: string | null;
  service?: string | null;
  symptoms?: string | null;
  rawContext: string;
  signature?: string | null;
  embedding?: number[] | null;
};

/** Normalize incident writes and contain the pgvector client type boundary. */
export function buildIncidentRecord(input: IncidentRecordInput) {
  return {
    title: input.title ?? null,
    service: input.service ?? null,
    symptoms: input.symptoms ?? null,
    raw_context: input.rawContext,
    signature: input.signature ?? null,
    embedding: embeddingForDatabase(input.embedding),
  };
}
