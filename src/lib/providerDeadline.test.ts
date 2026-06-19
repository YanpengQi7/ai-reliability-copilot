import { describe, expect, it } from "vitest";
import { classifyProviderDeadlineFailure, createProviderDeadline, PROVIDER_TIMEOUT_MS } from "./providerDeadline";

describe("createProviderDeadline", () => {
  it("uses the shared provider timeout by default", () => {
    const deadline = createProviderDeadline();
    expect(PROVIDER_TIMEOUT_MS).toBe(120_000);
    expect(deadline.signal).toBe(deadline.timeoutSignal);
    expect(deadline.signal.aborted).toBe(false);
  });

  it("propagates request cancellation into the combined signal", () => {
    const controller = new AbortController();
    const deadline = createProviderDeadline(controller.signal, 10_000);
    controller.abort();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timeoutSignal.aborted).toBe(false);
    expect(classifyProviderDeadlineFailure(controller.signal, deadline)).toBe("request_aborted");
  });

  it("distinguishes timeout from provider failures", async () => {
    const request = new AbortController();
    const deadline = createProviderDeadline(request.signal, 5);

    expect(classifyProviderDeadlineFailure(request.signal, deadline)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(classifyProviderDeadlineFailure(request.signal, deadline)).toBe("timed_out");
  });
});
