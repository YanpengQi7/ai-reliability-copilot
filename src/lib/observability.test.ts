import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestContext, safeErrorDetail } from "./observability";

describe("createRequestContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves a safe incoming request id and adds it to responses", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = createRequestContext(
      new Request("https://example.test", { headers: { "x-request-id": "edge-123" } }),
      "test",
    );
    const response = ctx.response(Response.json({ ok: true }));
    expect(ctx.requestId).toBe("edge-123");
    expect(response.headers.get("x-request-id")).toBe("edge-123");
    expect(log).toHaveBeenCalledOnce();
  });

  it("rejects unsafe incoming request ids", () => {
    const ctx = createRequestContext(
      new Request("https://example.test", { headers: { "x-request-id": "bad id value" } }),
      "test",
    );
    expect(ctx.requestId).not.toBe("bad id value");
    expect(ctx.requestId.length).toBeGreaterThan(10);
  });

  it("preserves the wrapped response body and status", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = createRequestContext(new Request("https://example.test"), "protocol");
    const payload = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
    const response = ctx.response(Response.json(payload, { status: 202 }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(payload);
  });

  it("logs request metadata without query strings or overridable core fields", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = createRequestContext(
      new Request("https://example.test/api/webhook/alert?secret=do-not-log", {
        method: "POST",
        headers: { "x-request-id": "edge-456" },
      }),
      "webhook_alert",
    );

    ctx.log("info", "background_complete", {
      request_id: "forged",
      operation: "forged",
      method: "DELETE",
      path: "/forged",
      incident_id: "incident-1",
    });

    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({
      level: "info",
      event: "background_complete",
      operation: "webhook_alert",
      request_id: "edge-456",
      method: "POST",
      path: "/api/webhook/alert",
      incident_id: "incident-1",
    });
    expect(JSON.stringify(entry)).not.toContain("do-not-log");
  });
});

describe("safeErrorDetail", () => {
  it("redacts credentials, removes newlines, and caps provider errors", () => {
    const secret = "sk-" + "aB3".repeat(20);
    const detail = safeErrorDetail(new Error(`provider failed\nAuthorization token=${secret}\n${"x".repeat(200)}`), 100);

    expect(detail).not.toContain(secret);
    expect(detail).not.toContain("\n");
    expect(detail.length).toBeLessThanOrEqual(101);
    expect(detail).toContain("[REDACTED:");
  });
});
