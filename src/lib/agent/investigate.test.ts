import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateText: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  ANALYSIS_MODEL: "test-model",
  deepseek: vi.fn(() => "test-model"),
}));

import { generateObject, generateText } from "ai";
import { investigate } from "./investigate";

const mockedGenerateText = vi.mocked(generateText);
const mockedGenerateObject = vi.mocked(generateObject);

describe("investigate cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGenerateText.mockResolvedValue({
      text: "Investigation complete",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as unknown as Awaited<ReturnType<typeof generateText>>);
  });

  it("does not retry structured output after the request is cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new Error("request cancelled");

    mockedGenerateObject.mockImplementationOnce(async () => {
      controller.abort(cancellation);
      throw new Error("invalid JSON");
    });

    await expect(investigate({
      input: { service: "checkout", symptoms: "errors", raw_context: "" },
      abortSignal: controller.signal,
    })).rejects.toBe(cancellation);

    expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("preserves user evidence in the final call when no tool evidence exists", async () => {
    mockedGenerateObject.mockResolvedValueOnce({ object: {}, usage: {} } as never);
    const result = await investigate({ input: { service: "checkout", symptoms: "errors", raw_context: "Only tenant A fails; tenant B succeeds, database CPU is 20%." } });
    const prompt = mockedGenerateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain("Only tenant A fails");
    expect(prompt).toContain("user-context");
    expect(result.evidence?.[0].source).toContain("not independently verified");
  });
});
