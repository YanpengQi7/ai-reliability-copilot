import { describe, expect, it } from "vitest";
import { createProviderDeadline, PROVIDER_TIMEOUT_MS } from "./providerDeadline";

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
  });
});
