import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));

vi.mock("../supabase", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { getTelemetryClientIp, logToolCall, withClientIp } from "./telemetry";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  mocks.supabaseAdmin.mockReset();
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("MCP telemetry request context", () => {
  it("keeps client IPs isolated across overlapping requests", async () => {
    const firstCanRead = deferred();
    const secondCanRead = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();

    const first = withClientIp("client-a", async () => {
      firstStarted.resolve();
      await firstCanRead.promise;
      return getTelemetryClientIp();
    });
    await firstStarted.promise;

    const second = withClientIp("client-b", async () => {
      secondStarted.resolve();
      await secondCanRead.promise;
      return getTelemetryClientIp();
    });
    await secondStarted.promise;

    firstCanRead.resolve();
    await expect(first).resolves.toBe("client-a");
    secondCanRead.resolve();
    await expect(second).resolves.toBe("client-b");
    expect(getTelemetryClientIp()).toBeNull();
  });

  it("restores an outer request context after nested work", async () => {
    await withClientIp("outer", async () => {
      await withClientIp("inner", async () => {
        expect(getTelemetryClientIp()).toBe("inner");
      });
      expect(getTelemetryClientIp()).toBe("outer");
    });
  });
});

describe("MCP telemetry persistence", () => {
  it("logs Supabase response errors without failing the tool call", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const error = new Error("telemetry table unavailable");
    const insert = vi.fn().mockResolvedValue({ error });
    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({ insert })),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(logToolCall({
      tool_name: "search_kb",
      ok: true,
      latency_ms: 12,
    })).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith("[mcp telemetry] failed:", error.message);
  });
});
