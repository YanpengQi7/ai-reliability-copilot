import { describe, it, expect } from "vitest";
import {
  dispatchTool,
  ALLOWED_TOOLS,
  PER_TOOL_CALL_CAP,
  MAX_OBSERVATION_CHARS,
  LOG_BUDGET_LINES_MAX,
  type DispatchContext,
} from "./tools";
import type { InvestigationInput } from "./types";

// The control gate is the line that makes the read-only investigator safe.
// These tests prove the gate refuses what it must BEFORE any handler runs —
// no LLM, no DB, fully deterministic.

const SCENARIO_INPUT: InvestigationInput = {
  service: "payment-svc",
  symptoms: "elevated latency",
  raw_context: "",
  scenarioSlug: "db-connection-pool-exhausted",
};

function freshCtx(input: InvestigationInput = SCENARIO_INPUT): DispatchContext {
  return { ctx: input, callCounts: {} };
}

describe("control gate", () => {
  it("refuses an unknown tool", async () => {
    const step = await dispatchTool(0, "rm_minus_rf", {}, freshCtx());
    expect(step.status).toBe("refused");
    expect(step.reason).toBe("unknown_tool");
  });

  it("refuses a write/mutating tool even though it is exposed to the model", async () => {
    const step = await dispatchTool(0, "execute_rollback", { service: "payment-svc" }, freshCtx());
    expect(step.status).toBe("refused");
    expect(step.reason).toBe("not_read_only");
    // It must tell the model what to do instead, not just say "no".
    expect(step.observation).toMatch(/mitigation_plan/i);
  });

  it("refuses restart_service (second write tool) too", async () => {
    const step = await dispatchTool(0, "restart_service", { service: "payment-svc" }, freshCtx());
    expect(step.status).toBe("refused");
    expect(step.reason).toBe("not_read_only");
  });

  it("enforces the per-tool call cap on a single dispatch context", async () => {
    const ctx = freshCtx();
    // First PER_TOOL_CALL_CAP calls are allowed (well-formed, allowed tool).
    for (let i = 0; i < PER_TOOL_CALL_CAP; i++) {
      const step = await dispatchTool(i, "get_metrics", { service: "payment-svc" }, ctx);
      expect(step.reason).not.toBe("call_cap");
    }
    // The next one trips the cap.
    const capped = await dispatchTool(PER_TOOL_CALL_CAP, "get_metrics", { service: "payment-svc" }, ctx);
    expect(capped.status).toBe("refused");
    expect(capped.reason).toBe("call_cap");
  });

  it("tracks call caps per-tool independently", async () => {
    const ctx = freshCtx();
    for (let i = 0; i < PER_TOOL_CALL_CAP; i++) {
      await dispatchTool(i, "get_metrics", { service: "payment-svc" }, ctx);
    }
    // A different tool still has its own budget.
    const other = await dispatchTool(99, "get_logs", { service: "payment-svc" }, ctx);
    expect(other.reason).not.toBe("call_cap");
  });

  it("only exposes read-only tools in ALLOWED_TOOLS", () => {
    expect(ALLOWED_TOOLS).not.toContain("execute_rollback");
    expect(ALLOWED_TOOLS).not.toContain("restart_service");
    expect(ALLOWED_TOOLS).toContain("get_metrics");
  });
});

describe("context budget (get_logs)", () => {
  it("clamps an over-budget limit to the hard max and reports the true total", async () => {
    const step = await dispatchTool(
      0,
      "get_logs",
      { service: "payment-svc", limit: 9999 },
      freshCtx(),
    );
    expect(step.status).toBe("ok");
    // The observation must never exceed the char clamp.
    expect(step.observation.length).toBeLessThanOrEqual(MAX_OBSERVATION_CHARS + 120);
    // Header reports "showing N of M" so the model knows logs were truncated.
    const m = step.observation.match(/showing (\d+) of (\d+)/);
    if (m) {
      const shown = Number(m[1]);
      expect(shown).toBeLessThanOrEqual(LOG_BUDGET_LINES_MAX);
    }
  });
});

describe("dispatch recovery", () => {
  it("propagates request cancellation instead of converting it to a tool error", async () => {
    const controller = new AbortController();
    controller.abort(new Error("request cancelled"));
    const ctx = { ...freshCtx(), abortSignal: controller.signal };

    await expect(dispatchTool(0, "get_metrics", { service: "payment-svc" }, ctx))
      .rejects.toThrow("request cancelled");
  });

  it("returns a normal empty/ok step for a service with no telemetry rather than throwing", async () => {
    // No scenarioSlug → handlers return status:empty, never throw.
    const step = await dispatchTool(
      0,
      "get_metrics",
      { service: "whatever" },
      freshCtx({ service: "whatever", symptoms: "x", raw_context: "some prose" }),
    );
    expect(["empty", "ok"]).toContain(step.status);
    expect(typeof step.observation).toBe("string");
  });
});
