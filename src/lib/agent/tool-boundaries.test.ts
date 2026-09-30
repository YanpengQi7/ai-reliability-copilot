import { describe, expect, it, vi } from "vitest";
import { dispatchTool, MAX_OBSERVATION_CHARS } from "./tools";
import { evidenceItem, type EvidenceItem } from "./evidence";
const at = "2026-09-01T00:00:00.000Z";
const item = (id: string, text: string) => evidenceItem({ id, kind: "metric", source: "fixture", service: "payment-svc", observed_at: at, available_at: at, text });

describe("read-only observation boundaries", () => {
  it.each(["observed_at", "available_at"] as const)("rejects future %s atomically before trimming observation budgets", async field => {
    const original = item("original", "known observation");
    const future = evidenceItem({ ...item("future", "private future observation ".repeat(130)), [field]: "2027-01-01T00:00:00.000Z" });
    const context = { ctx: { raw_context: "" }, callCounts: {}, evidenceAt: at, evidenceRegistry: [original], adapter: { read: async () => [item("current", "visible"), future] } };
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, context);
    expect(result).toMatchObject({ status: "error", reason: "invalid_evidence" });
    expect(result.observation).toContain("future_evidence");
    expect(result.observation).not.toContain("private future observation");
    expect(result.evidence).toBeUndefined();
    expect(context.evidenceRegistry).toEqual([original]);
  });
  it("rejects forged hashes without accepting any records from the batch", async () => {
    const context = { ctx: { raw_context: "" }, callCounts: {}, evidenceRegistry: [], adapter: { read: async () => [item("good", "visible"), { ...item("forged", "original"), text: "private forged observation" }] } };
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, context);
    expect(result).toMatchObject({ status: "error", reason: "invalid_evidence" });
    expect(result.observation).toContain("hash_mismatch");
    expect(result.observation).not.toContain("private forged observation");
    expect(context.evidenceRegistry).toEqual([]);
  });
  it("rejects conflicting IDs even when the conflicting record would exceed the budget", async () => {
    const original = item("known", "original");
    const context = { ctx: { raw_context: "" }, callCounts: {}, evidenceRegistry: [original], adapter: { read: async () => [item("known", "x".repeat(3000)), item("good", "visible")] } };
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, context);
    expect(result).toMatchObject({ status: "error", reason: "invalid_evidence" });
    expect(result.observation).toContain("conflicting_id");
    expect(result.evidence).toBeUndefined();
    expect(context.evidenceRegistry).toEqual([original]);
  });
  it("validates the cutoff before making adapter calls", async () => {
    const read = vi.fn(async () => []);
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, { ctx: { raw_context: "" }, callCounts: {}, evidenceAt: "invalid", adapter: { read } });
    expect(result).toMatchObject({ status: "error", reason: "invalid_evidence" });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects reused IDs across reads and preserves the first observation", async () => {
    const first = item("m1", "errors 10%");
    const read = vi.fn().mockResolvedValueOnce([first]).mockResolvedValueOnce([item("m1", "errors 0%")]).mockResolvedValueOnce([item("m2", "errors 0%")]);
    const context = { ctx: { raw_context: "" }, callCounts: {}, adapter: { read } };
    expect((await dispatchTool(1, "get_metrics", { service: "payment-svc" }, context)).status).toBe("ok");
    const conflict = await dispatchTool(2, "get_metrics", { service: "payment-svc" }, context);
    expect(conflict.status).toBe("error");
    expect(conflict.observation).toContain("Conflicting evidence ID");
    expect(conflict.evidence).toBeUndefined();
    expect((await dispatchTool(3, "get_metrics", { service: "payment-svc" }, context)).status).toBe("ok");
  });
  it.each(["user-context", "alert-context", "tool-1"])("rejects reserved adapter ID %s", async id => {
    const result = await dispatchTool(1, "get_metrics", { service: "payment-svc" }, { ctx: { raw_context: "" }, callCounts: {}, adapter: { read: async () => [item(id, "fake user report")] } });
    expect(result.status).toBe("error");
    expect(result.observation).toContain("reserved evidence ID");
  });
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
  it.each([
    ["get_metrics", "metric", "runbook"],
    ["get_logs", "log", "metric"],
    ["get_deploy_history", "deploy", "log"],
    ["search_runbooks", "runbook", "deploy"],
  ] as const)("rejects mixed-kind adapter output for %s atomically", async (tool, validKind, wrongKind) => {
    const make = (id: string, kind: EvidenceItem["kind"]) => evidenceItem({ id, kind, source: "fixture", service: "payment-svc", observed_at: at, available_at: at, text: "Observation" });
    const original = make("existing", validKind);
    const context = { ctx: { raw_context: "" }, callCounts: {}, evidenceRegistry: [original], adapter: { read: vi.fn(async () => [make("valid", validKind), make("wrong", wrongKind)]) } };
    const args = tool === "search_runbooks" ? { query: "payment" } : { service: "payment-svc" };
    const result = await dispatchTool(1, tool, args, context);
    expect(result.status).toBe("error");
    expect(result.observation).toContain("evidence kind incompatible");
    expect(result.evidence).toBeUndefined();
    expect(context.evidenceRegistry).toEqual([original]);
    context.adapter.read.mockResolvedValue([make("valid", validKind)]);
    const retry = await dispatchTool(2, tool, args, context);
    expect(retry.status).toBe("ok");
    expect(retry.evidence).toHaveLength(1);
  });
  it("preserves reported context in log reads and cross-service runbook guidance", async () => {
    for (const [tool, kind, service] of [["get_logs", "user_context", "payment-svc"], ["search_runbooks", "runbook", "shared-platform"]] as const) {
      const record = evidenceItem({ id: "guidance", kind, service, source: "fixture", observed_at: at, available_at: at, text: "Reported context or guidance" });
      const args = tool === "search_runbooks" ? { query: "payment" } : { service: "payment-svc" };
      const result = await dispatchTool(1, tool, args, { ctx: { raw_context: "" }, callCounts: {}, adapter: { read: async () => [record] } });
      expect(result.status).toBe("ok");
      expect(result.evidence).toEqual([record]);
    }
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
