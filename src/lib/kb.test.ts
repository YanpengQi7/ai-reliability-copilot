import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));

vi.mock("./supabase", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { ingestDocument, recordRetrievedChunks, type RetrievedChunk } from "./kb";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const chunk: RetrievedChunk = {
  chunk_id: "chunk-1",
  document_id: "document-1",
  text: "Restart the unhealthy worker.",
  similarity: 0.91,
  document_title: "Worker runbook",
  document_kind: "runbook",
  source_path: "runbooks/worker.md",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  mocks.supabaseAdmin.mockReset();
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

function mockInsert(result: { error: unknown }) {
  const abortSignal = vi.fn();
  const query = Object.assign(Promise.resolve(result), { abortSignal });
  const insert = vi.fn(() => query);
  const from = vi.fn(() => ({ insert }));
  mocks.supabaseAdmin.mockReturnValue({ from });
  return { abortSignal, from, insert };
}

describe("recordRetrievedChunks", () => {
  it("writes ranked audit rows and propagates cancellation", async () => {
    const signal = new AbortController().signal;
    const { abortSignal, from, insert } = mockInsert({ error: null });

    await recordRetrievedChunks("analysis-1", [chunk], { abortSignal: signal });

    expect(from).toHaveBeenCalledWith("analysis_kb_chunks");
    expect(insert).toHaveBeenCalledWith([{
      analysis_id: "analysis-1",
      chunk_id: "chunk-1",
      similarity: 0.91,
      rank: 0,
    }]);
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("surfaces audit write failures to the caller", async () => {
    const error = new Error("database unavailable");
    mockInsert({ error });

    await expect(recordRetrievedChunks("analysis-1", [chunk])).rejects.toBe(error);
  });

  it("does not open a database client when there are no chunks", async () => {
    await expect(recordRetrievedChunks("analysis-1", [])).resolves.toBeUndefined();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });
});

describe("ingestDocument", () => {
  const input = {
    source_path: "runbooks/worker.md",
    kind: "runbook" as const,
    raw_text: "Restart the unhealthy worker after checking the queue depth.",
  };

  it("stops when the existing-document lookup fails", async () => {
    const error = new Error("lookup unavailable");
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({ select })),
    });

    await expect(ingestDocument(input)).rejects.toBe(error);
  });

  it("stops when old chunks cannot be deleted", async () => {
    const error = new Error("chunk delete unavailable");
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectExisting = vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    }));
    const single = vi.fn().mockResolvedValue({ data: { id: "document-1" }, error: null });
    const upsert = vi.fn(() => ({
      select: vi.fn(() => ({ single })),
    }));
    const deleteChunks = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error }),
    }));
    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn((table: string) => table === "kb_documents"
        ? { select: selectExisting, upsert }
        : { delete: deleteChunks }),
    });

    await expect(ingestDocument(input)).rejects.toBe(error);
  });
});
