import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mocks.create } };
  },
}));

import { describeImage, hasVisionProvider } from "./vision";

describe("vision provider", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mocks.create.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("reports provider availability from configuration", () => {
    expect(hasVisionProvider()).toBe(true);
    delete process.env.OPENAI_API_KEY;
    expect(hasVisionProvider()).toBe(false);
  });

  it("does not call the provider when already cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new Error("request cancelled");
    controller.abort(cancellation);

    await expect(describeImage("https://example.com/screenshot.png", controller.signal))
      .rejects.toBe(cancellation);

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not return a description after cancellation races the provider response", async () => {
    const controller = new AbortController();
    const cancellation = new Error("request cancelled");
    mocks.create.mockImplementationOnce(async () => {
      controller.abort(cancellation);
      return { choices: [{ message: { content: "dashboard facts" } }] };
    });

    await expect(describeImage("https://example.com/screenshot.png", controller.signal))
      .rejects.toBe(cancellation);

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
      { signal: controller.signal },
    );
  });
});
