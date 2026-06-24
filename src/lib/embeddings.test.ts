import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    embeddings = { create: mocks.create };
  },
}));

import { embed, embeddingForDatabase, EMBEDDING_TIMEOUT_MS } from "./embeddings";

describe("embed", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mocks.create.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it("bounds the provider request and returns its vector", async () => {
    mocks.create.mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });

    await expect(embed("incident signature")).resolves.toEqual([0.1, 0.2]);
    expect(EMBEDDING_TIMEOUT_MS).toBe(10_000);
    expect(mocks.create).toHaveBeenCalledWith(
      { model: "text-embedding-3-small", input: "incident signature" },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: EMBEDDING_TIMEOUT_MS,
        maxRetries: 1,
      }),
    );
  });

  it("propagates request cancellation and preserves the null fallback", async () => {
    const controller = new AbortController();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.create.mockImplementation(async (_body, options) => {
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    });

    const result = embed("incident signature", controller.signal);
    controller.abort();

    await expect(result).resolves.toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("logs provider failures while preserving the null fallback", async () => {
    const error = new Error("provider unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.create.mockRejectedValue(error);

    await expect(embed("incident signature")).resolves.toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      "[embed] failed:",
      error.message,
      { timed_out: false },
    );
  });
});

describe("embeddingForDatabase", () => {
  it("preserves vectors and normalizes missing values", () => {
    const vector = [0.1, 0.2];
    expect(embeddingForDatabase(vector)).toBe(vector);
    expect(embeddingForDatabase(null)).toBeNull();
    expect(embeddingForDatabase()).toBeNull();
  });
});
