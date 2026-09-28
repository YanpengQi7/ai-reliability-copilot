import { describe, expect, it, vi } from "vitest";
import { dispatchTool, MAX_OBSERVATION_CHARS } from "./tools";
import { evidenceItem } from "./evidence";
const at = "2026-09-01T00:00:00.000Z";
const item = (id: string, text: string) => evidenceItem({ id, kind: "metric", source: "fixture", service: "payment-svc", observed_at: at, available_at: at, text });

describe("read-only observation boundaries", () => {
  it("does not return another service's scenario telemetry via substring matching", async () => {
    const ctx = { ctx: { raw_context: "", scenarioSlug: "db-connection-pool-exhausted" }, callCounts: {} };
    const blank = await dispatchTool(0, "get_metrics", { service: "  " }, ctx);
    expect(blank.status).toBe("refused");
    const wrong = await dispatchTool(1, "get_metrics", { service: "not-payment-svc" }, ctx);
    expect(wrong.status).toBe("empty"); expect(wrong.observation).toContain("No telemetry");
    const exact = await dispatchTool(2, "get_metrics", { service: "PAYMENT-SVC" }, ctx);
    expect(exact.status).toBe("ok");
  });
  it("rejects telemetry from an adapter that violates service isolation", async () => {
    const result = await dispatchTool(1, "get_metrics", { service: "checkout" }, { ctx: { raw_context: "" }, callCounts: {}, adapter: { read: async () => [item("wrong-service", "healthy")] } });
    expect(result.status).toBe("error");
    expect(result.observation).toContain("different service");
    expect(result.evidence).toBeUndefined();
  });
  it("does not lose smaller evidence behind an oversized first result", async () => {
    const short = item("short", "connections 500/500");
    const read = vi.fn(async () => [item("large", "x".repeat(3000)), short]);
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, { ctx: { raw_context: "" }, callCounts: {}, adapter: { read } });
    expect(result.status).toBe("ok"); expect(result.evidence).toEqual([short]);
    expect(result.reason).toBe("observation_budget");
    expect(result.observation).toContain("1 record(s) omitted");
    expect(result.observation.length).toBeLessThanOrEqual(MAX_OBSERVATION_CHARS);
  });
  it("distinguishes oversized evidence from no matching records", async () => {
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, { ctx: { raw_context: "" }, callCounts: {}, adapter: { read: async () => [item("large", "x".repeat(3000))] } });
    expect(result.observation).toContain("Matching evidence exists");
    expect(result.evidence).toEqual([]);
  });
  it("refuses malformed adapter evidence without passing it to the model", async () => {
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, { ctx: { raw_context: "" }, callCounts: {}, adapter: { read: async () => [{ id: "bad" }] as never } });
    expect(result.status).toBe("error");
    expect(result.evidence).toBeUndefined();
  });
});
