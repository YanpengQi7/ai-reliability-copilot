import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), generateText: vi.fn() }));
vi.mock("@/lib/ai", () => ({ ANALYSIS_MODEL: "test-model", deepseek: vi.fn(() => "test-model") }));
import { generateText } from "ai";
import { investigate } from "./investigate";
import { evidenceItem } from "./evidence";
import { DiagnosisSchema, type Diagnosis } from "./diagnosis";
import type { InvestigationModel } from "./runtime";
import { DiagnosisValidationError } from "./diagnosisValidation";

const diagnosis: Diagnosis = { summary: "Scope is unverified", conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "Missing scope", root_causes: [], claims: [], mitigation_plan: [], missing_information: ["Affected users"] };
const at = "2026-09-01T00:00:00.000Z";
const e = evidenceItem({ id: "metric", kind: "metric", source: "fixture", service: "checkout", observed_at: at, available_at: at, text: "connections saturated" });
const plan = (done = false, query = "") => ({ hypotheses: [], done, tool: "get_metrics", query, reason: "Inspect connections" });
function client(decide: (input: Record<string, unknown>) => unknown): InvestigationModel {
  return { async call<T>(schema: z.ZodType<T>, _system: string, prompt: string) { return schema.parse(Object.is(schema, DiagnosisSchema) ? diagnosis : decide(JSON.parse(prompt))); } };
}

describe("production shared investigator", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses structured SDK output without a second presentation model call", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ output: plan(true), totalUsage: { inputTokens: 2, outputTokens: 3 } } as never)
      .mockResolvedValueOnce({ output: diagnosis, totalUsage: { inputTokens: 4, outputTokens: 5 } } as never);
    const result = await investigate({ input: { service: "checkout", raw_context: "" } });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.usage).toMatchObject({ model_calls: 2, tokens_in: 6, tokens_out: 8 });
    expect(result.analysis.severity).toBeNull();
    expect(result.analysis.root_causes).toEqual([]);
    expect(result.diagnosis).toEqual(diagnosis);
    for (const [args] of vi.mocked(generateText).mock.calls) expect(args).toMatchObject({ temperature: 0, maxRetries: 0 });
  });
  it("does not conclude or retry after cancellation", async () => {
    const controller = new AbortController(), cancellation = new Error("request cancelled");
    const call = vi.fn(async () => { controller.abort(cancellation); return plan(true); });
    await expect(investigate({ input: { raw_context: "" }, modelClient: { call } as InvestigationModel, abortSignal: controller.signal })).rejects.toBe(cancellation);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("stops when different queries repeatedly return identical evidence", async () => {
    let count = 0;
    const result = await investigate({ input: { service: "checkout", raw_context: "" }, adapter: { read: async () => [e] }, modelClient: client(() => plan(false, `query-${++count}`)) });
    expect(result.steps).toBe(3);
    expect(result.stop_reason).toBe("no_progress");
    expect(result.completed).toBe(false);
    expect(result.evidence?.map(e => e.id)).toEqual(["alert-context", "metric"]);
    expect(result.analysis.summary).toContain("incomplete");
  });
  it("recovers transient reads and preserves limitations only as untrusted context", async () => {
    const prompts: string[] = [], systems: string[] = [];
    const read = vi.fn().mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValueOnce([e]);
    const model = client(input => plan((input.history as unknown[]).length === 2));
    const wrapped: InvestigationModel = { async call(schema, system, prompt, purpose) { systems.push(system); prompts.push(prompt); return model.call(schema, system, prompt, purpose); } };
    const result = await investigate({ input: { service: "checkout", raw_context: "" }, adapter: { read }, modelClient: wrapped });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.stop_reason).toBe("model_done");
    expect(prompts.at(-1)).toContain("temporary outage");
    expect(JSON.parse(prompts.at(-1)!).limitations).toHaveLength(1);
    expect(systems.every(s => !s.includes("connections saturated"))).toBe(true);
  });
  it("preserves reported evidence without inventing causes, commands or mitigations", async () => {
    const result = await investigate({ input: { service: "checkout", raw_context: "Only tenant A fails; tenant B succeeds" }, modelClient: client(() => plan(true)), alertAt: at });
    expect(result.evidence?.find(e => e.id === "user-context")?.text).toContain("Only tenant A fails");
    expect(result.analysis.root_causes).toEqual([]);
    expect(result.analysis.investigation_checklist).toEqual([]);
    expect(result.analysis.mitigation_plan).toEqual([]);
    expect(result.analysis.customer_impact).toBe(diagnosis.severity_reasoning);
  });
  it("refuses unsupported planner references before another read", async () => {
    const read = vi.fn();
    const bad = { ...plan(), hypotheses: [{ hypothesis: "cause", supporting_ids: ["unseen"], refuting_ids: [], missing: "" }] };
    await expect(investigate({ input: { service: "checkout", raw_context: "" }, adapter: { read }, modelClient: client(() => bad) })).rejects.toThrow(/has not seen/);
    expect(read).not.toHaveBeenCalled();
  });
  it("propagates planner failures without generating an unmeasured fallback", async () => {
    const failure = new Error("provider unavailable");
    const call = vi.fn(async () => { throw failure; });
    await expect(investigate({ input: { service: "checkout", raw_context: "" }, modelClient: { call } })).rejects.toBe(failure);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("withholds a final diagnosis with fabricated citations without a repair call", async () => {
    const invalid = { ...diagnosis, claims: [{ id: "c1", text: "A private invented measurement", kind: "observed", evidence_ids: ["never-read"] }] };
    vi.mocked(generateText).mockResolvedValueOnce({ output: plan(true), totalUsage: { inputTokens: 2, outputTokens: 3 } } as never)
      .mockResolvedValueOnce({ output: invalid, totalUsage: { inputTokens: 4, outputTokens: 5 } } as never);
    await expect(investigate({ input: { service: "checkout", raw_context: "" } })).rejects.toBeInstanceOf(DiagnosisValidationError);
    expect(generateText).toHaveBeenCalledTimes(2);
  });
  it("keeps checkpoint consumers from modifying live evidence or decisions", async () => {
    const result = await investigate({ input: { service: "checkout", raw_context: "" }, modelClient: client(() => plan(true)),
      onCheckpoint: state => { state.evidence.length = 0; state.decisions.length = 0; state.stop_reason = "step_cap"; } });
    expect(result.evidence?.[0].id).toBe("alert-context");
    expect(result.decisions).toHaveLength(1);
    expect(result.stop_reason).toBe("model_done");
  });
  it("rejects invalid limits before model calls", async () => {
    const call = vi.fn();
    await expect(investigate({ input: { raw_context: "" }, maxSteps: 0, modelClient: { call } })).rejects.toThrow(/maxSteps/);
    expect(call).not.toHaveBeenCalled();
  });
});
