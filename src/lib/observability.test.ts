import { describe, expect, it, vi } from "vitest";
import { createRequestContext } from "./observability";

describe("createRequestContext", () => {
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
    log.mockRestore();
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
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = createRequestContext(new Request("https://example.test"), "protocol");
    const payload = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
    const response = ctx.response(Response.json(payload, { status: 202 }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(payload);
    log.mockRestore();
  });
});
