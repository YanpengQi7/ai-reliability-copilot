import { describe, expect, it } from "vitest";
import { Scratchpad } from "./state";
import type { TraceStep } from "./types";

const step: TraceStep = { index: 1, tool: "get_logs", input: { service: "checkout", query: "timeout" }, status: "ok", observation: "connection timeout", latency_ms: 1 };
describe("investigation state", () => {
  it("deduplicates reordered arguments without conflating different values", () => {
    const state = new Scratchpad(); state.record(step);
    expect(state.isDuplicate("get_logs", { query: "timeout", service: "checkout" })).toBe(true);
    expect(state.isDuplicate("get_logs", { query: "OOM", service: "checkout" })).toBe(false);
    state.record({ ...step, input: { nested: { a: 1, b: 2 } } });
    expect(state.isDuplicate("get_logs", { nested: { b: 2, a: 1 } })).toBe(true);
    expect(state.isDuplicate("get_logs", { nested: { a: 2, b: 2 } })).toBe(false);
  });
  it("permits one retry after failure, then stops repeated failures", () => {
    const state = new Scratchpad(); const error = { ...step, status: "error" as const };
    state.record(error); expect(state.isDuplicate(step.tool, step.input)).toBe(false);
    state.record(error); expect(state.isDuplicate(step.tool, step.input)).toBe(true);
    expect(state.evidenceCount()).toBe(0);
    expect(state.render({ stepsUsed: 2, stepCap: 8 })).toContain("2 failure(s)");
  });
  it("does not retry permanent evidence-contract failures", () => {
    const state = new Scratchpad();
    state.record({ ...step, status: "error", reason: "invalid_evidence" });
    expect(state.isDuplicate(step.tool, step.input)).toBe(true);
    expect(state.isDuplicate(step.tool, { ...step.input, query: "other source" })).toBe(false);
    expect(state.evidenceCount()).toBe(0);
  });
  it("does not repeat successful, empty or refused reads", () => {
    for (const status of ["ok", "empty", "refused"] as const) {
      const state = new Scratchpad(); state.record({ ...step, status });
      expect(state.isDuplicate(step.tool, step.input)).toBe(true);
    }
  });
  it("bounds and deduplicates repeated observation excerpts", () => {
    const state = new Scratchpad();
    state.record({ ...step, observation: "x".repeat(20000) });
    state.record({ ...step, observation: "x".repeat(20000), input: { service: "checkout", query: "different" } });
    expect(state.evidenceCount()).toBe(1);
    expect(state.render({ stepsUsed: 2, stepCap: 8 }).length).toBeLessThan(1500);
  });
});
