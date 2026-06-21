import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));

vi.mock("../supabase", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { getTelemetryClientIp, logToolCall, telemetryClientKey, TELEMETRY_WRITE_TIMEOUT_MS, withClientIp } from "./telemetry";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalTelemetrySalt = process.env.MCP_TELEMETRY_SALT;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  if (originalTelemetrySalt === undefined) delete process.env.MCP_TELEMETRY_SALT;
  else process.env.MCP_TELEMETRY_SALT = originalTelemetrySalt;
  mocks.supabaseAdmin.mockReset();
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockTelemetryInsert(result: { error: unknown }) {
  const abortSignal = vi.fn();
  const query = Object.assign(Promise.resolve(result), { abortSignal });
  const insert = vi.fn(() => query);
  mocks.supabaseAdmin.mockReturnValue({
    from: vi.fn(() => ({ insert })),
  });
  return { abortSignal, insert };
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
  it("stores a stable keyed client digest instead of a raw IP", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.MCP_TELEMETRY_SALT = "telemetry-test-salt";
    const { abortSignal, insert } = mockTelemetryInsert({ error: null });

    await logToolCall({
      tool_name: "search_kb",
      ok: true,
      latency_ms: 12,
      client_ip: "203.0.113.42",
    });

    const stored = insert.mock.calls[0][0].client_ip as string;
    expect(stored).toBe(telemetryClientKey("203.0.113.42"));
    expect(stored).toMatch(/^client_[a-f0-9]{24}$/);
    expect(stored).not.toContain("203.0.113.42");
    expect(TELEMETRY_WRITE_TIMEOUT_MS).toBe(3_000);
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("logs Supabase response errors without failing the tool call", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const error = new Error("telemetry table unavailable");
    mockTelemetryInsert({ error });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(logToolCall({
      tool_name: "search_kb",
      ok: true,
      latency_ms: 12,
    })).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith("[mcp telemetry] failed:", error.message);
  });
});
