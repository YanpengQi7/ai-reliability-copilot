import { describe, expect, it, vi } from "vitest";
import { alertEvidence, evidenceItem } from "./evidence";
import { runInvestigation } from "./runtime";
import type { InvestigationModel } from "./runtime";
import { DiagnosisSchema } from "./diagnosis";
const alert = { service: "checkout", symptoms: "Timeouts", at: "2026-09-01T00:00:00.000Z" };
const future = evidenceItem({ id: "future", kind: "metric", source: "fixture", service: alert.service, text: "Private future recovery", observed_at: "2026-09-02T00:00:00.000Z", available_at: alert.at });

describe("shared runtime evidence ingestion", () => {
  it.each(["alert", "full", "workflow", "agentic"] as const)("rejects future initial evidence before model or adapter calls in %s mode", async mode => {
    const call = vi.fn(), read = vi.fn();
    await expect(runInvestigation({ input: { raw_context: "" }, alert, mode, initialEvidence: [alertEvidence(alert), future], model: { call }, adapter: { read } })).rejects.toThrow(/investigation cutoff/);
    expect(call).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects future full-context evidence before synthesis", async () => {
    const call = vi.fn();
    await expect(runInvestigation({ input: { raw_context: "" }, alert, mode: "full", initialEvidence: [alertEvidence(alert)], fullEvidence: [future], model: { call } })).rejects.toThrow(/investigation cutoff/);
    expect(call).not.toHaveBeenCalled();
  });
  it("rejects tampered initial evidence before spending or checkpointing", async () => {
    const call = vi.fn(), onCheckpoint = vi.fn();
    await expect(runInvestigation({ input: { raw_context: "" }, alert, initialEvidence: [{ ...alertEvidence(alert), text: "Altered report" }], model: { call }, onCheckpoint })).rejects.toThrow(/content hash/);
    expect(call).not.toHaveBeenCalled();
    expect(onCheckpoint).not.toHaveBeenCalled();
  });
  it("preserves initial observations when an adapter reuses their IDs with different content", async () => {
    const original = evidenceItem({ ...future, id: "known", observed_at: alert.at, text: "Initial observation" });
    const altered = evidenceItem({ ...original, text: "Private altered observation" });
    const read = vi.fn(async () => [altered]), prompts: string[] = [];
    const model: InvestigationModel = { async call(schema, _system, prompt) {
      prompts.push(prompt);
      return schema.parse(Object.is(schema, DiagnosisSchema)
        ? { summary: "Scope unresolved", conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "Missing scope", root_causes: [], claims: [], mitigation_plan: [], missing_information: ["Scope"] }
        : { hypotheses: [], done: false, tool: "get_metrics", query: "", reason: "Inspect" });
    } };
    const result = await runInvestigation({ input: { raw_context: "", service: alert.service }, alert, initialEvidence: [alertEvidence(alert), original], model, adapter: { read } });
    expect(read).toHaveBeenCalledOnce();
    expect(result.trace.map(step => step.reason)).toEqual(["invalid_evidence", "duplicate"]);
    expect(result.evidence).toEqual([alertEvidence(alert), original]);
    expect(prompts.join("\n")).not.toContain("Private altered observation");
  });
  it("can gather valid evidence from another tool after rejecting a bad batch", async () => {
    const valid = evidenceItem({ ...future, id: "valid-log", kind: "log", observed_at: alert.at, text: "Connection timeout errors" });
    const forged = { ...valid, id: "forged", kind: "metric" as const, text: "Private forged observation" };
    const read = vi.fn(async (tool: string) => tool === "get_metrics" ? [forged] : [valid]);
    const model: InvestigationModel = { async call(schema, _system, prompt) {
      const history = JSON.parse(prompt).history as unknown[] | undefined;
      return schema.parse(Object.is(schema, DiagnosisSchema)
        ? { summary: "Timeouts observed; cause unresolved", conclusion_status: "tentative", severity: null, severity_reasoning: "Scope missing", root_causes: [], claims: [{ id: "c1", text: valid.text, kind: "observed", evidence_ids: [valid.id] }], mitigation_plan: [], missing_information: ["Scope"] }
        : { hypotheses: [], done: history!.length >= 2, tool: history!.length ? "get_logs" : "get_metrics", query: "", reason: "Use an independent check" });
    } };
    const result = await runInvestigation({ input: { raw_context: "", service: alert.service }, alert, initialEvidence: [alertEvidence(alert)], model, adapter: { read } });
    expect(read.mock.calls.map(([tool]) => tool)).toEqual(["get_metrics", "get_logs"]);
    expect(result.stop_reason).toBe("model_done");
    expect(result.evidence.map(item => item.id)).toEqual(["alert-context", valid.id]);
    expect(result.diagnosis.claims[0].evidence_ids).toEqual([valid.id]);
  });
});
