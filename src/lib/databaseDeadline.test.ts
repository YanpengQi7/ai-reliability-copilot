import { describe, expect, it } from "vitest";
import { classifyDatabaseDeadlineFailure, createDatabaseDeadline, createDatabaseQuerySignal, DATABASE_QUERY_TIMEOUT_MS } from "./databaseDeadline";

describe("createDatabaseQuerySignal", () => {
  it("uses the shared database timeout by default", () => {
    const signal = createDatabaseQuerySignal();
    expect(DATABASE_QUERY_TIMEOUT_MS).toBe(10_000);
    expect(signal.aborted).toBe(false);
  });

  it("aborts bounded database work", async () => {
    const signal = createDatabaseQuerySignal(5);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal.aborted).toBe(true);
  });

  it("distinguishes request cancellation from database timeout", async () => {
    const request = new AbortController();
    const cancelled = createDatabaseDeadline(request.signal, 10_000);
    request.abort();
    expect(classifyDatabaseDeadlineFailure(request.signal, cancelled)).toBe("request_aborted");

    const timedOut = createDatabaseDeadline(undefined, 5);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(classifyDatabaseDeadlineFailure(undefined, timedOut)).toBe("timed_out");
  });
});
