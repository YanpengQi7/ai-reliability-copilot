import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { investigate } from "../agent/investigate";
import { DiagnosisSchema, DecisionSchema, type Diagnosis } from "../agent/diagnosis";
import { DIAGNOSIS_PROMPT, PLANNER_PROMPT } from "../agent/diagnosisPrompt";
import { replayProductionTrial } from "./replay";
import { INVESTIGATION_ENGINE_VERSION } from "../agent/runtime";
import { FixtureAdapter, loadDataset, visibleEvidence } from "./dataset";
import { generateTrial, plannedTrials, type EvalModel } from "./engine";
import { ManifestSchema } from "./contracts";
import { hash } from "./artifacts";
import { evidenceItem } from "../agent/evidence";
import { buildReport } from "./report";

const cases = loadDataset("evals/datasets/sre-v2/cases.json").slice(0, 1), c = cases[0];
const manifest = ManifestSchema.parse({ version: "eval-v2", engine_version: INVESTIGATION_ENGINE_VERSION, id: "parity", created_at: "now", git_sha: "sha", dirty: false, source_hash: "source", dataset_hash: hash(cases), prompt_hash: hash({ diagnosis: DIAGNOSIS_PROMPT, planner: PLANNER_PROMPT }), schema_hash: hash({ diagnosis: z.toJSONSchema(DiagnosisSchema), decision: z.toJSONSchema(DecisionSchema) }), rubric_hash: "rubric", policy_version: "impact-v2", model: "mock", judge_model: "mock", modes: ["agentic"], languages: ["en"], repeats: 1, seed: 1, budget: { max_usd: 1, per_call_usd: 1, max_calls: 10, max_minutes: 10, max_output_tokens: 100, input_per_million: 0, output_per_million: 0, judge_input_per_million: 0, judge_output_per_million: 0 }, case_ids: [c.id], protocol: { min_families: 2, noninferiority_margin: 0.05, max_cost_ratio: 2 } });
const diagnosis: Diagnosis = { summary: "Unverified cause", conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "Missing scope", root_causes: [], claims: [], mitigation_plan: [], missing_information: ["Scope"] };

describe("production/eval execution parity", () => {
  it.each(["future", "forged"] as const)("rejects %s adapter data identically in production and eval without re-reading it", async kind => {
    const metric = visibleEvidence(c).find(e => e.kind === "metric")!;
    const invalid = kind === "future" ? evidenceItem({ ...metric, id: "untrusted", observed_at: "2026-09-02T00:00:00.000Z", text: "Private untrusted observation" }) : { ...metric, id: "untrusted", text: "Private untrusted observation" };
    const read = vi.spyOn(FixtureAdapter.prototype, "read").mockResolvedValue([invalid]);
    try {
      const prompts: string[] = [];
      const model: EvalModel = { async call(schema, _system, prompt) {
        prompts.push(prompt);
        return schema.parse(Object.is(schema, DiagnosisSchema) ? diagnosis : { hypotheses: [], done: false, tool: "get_metrics", query: "", reason: "Inspect" });
      } };
      const production = await investigate({ input: { service: c.alert.service, symptoms: c.alert.symptoms, raw_context: "" }, alertAt: c.alert.at, modelClient: model, adapter: new FixtureAdapter(visibleEvidence(c), c.alert.at), allowInternalKb: false });
      const productionPrompts = prompts.splice(0);
      const trial = plannedTrials(manifest, cases)[0];
      await generateTrial(trial, c, manifest, model, () => {});
      expect(prompts).toEqual(productionPrompts);
      expect(prompts.join("\n")).not.toContain("Private untrusted observation");
      expect(read).toHaveBeenCalledTimes(2); // Once per investigation, despite repeated planner requests.
      expect(production.trace.map(step => step.reason)).toEqual(["invalid_evidence", "duplicate"]);
      expect(production.evidence?.map(e => e.id)).toEqual(["alert-context"]);
      expect(trial.evidence).toEqual(production.evidence);
      expect(trial.stop_reason).toBe("no_progress");
      trial.status = "succeeded";
      const report = buildReport(manifest, cases, [trial], []);
      expect(report.modes.agentic).toMatchObject({ rejected_evidence_reads: 1, trials_with_rejected_evidence: 1, assessed: 0 });
    } finally { read.mockRestore(); }
  });
  it.each(["model_done", "no_progress"] as const)("replays exact production prompts, schema and diagnosis for %s", async stop => {
    const tape: { schema: unknown; system: string; prompt: unknown; output: unknown }[] = [];
    const recording: EvalModel = { async call<T>(schema: z.ZodType<T>, system: string, prompt: string) {
      const input = JSON.parse(prompt);
      const output = Object.is(schema, DiagnosisSchema) ? diagnosis : { hypotheses: [], done: stop === "model_done" && input.history.length > 0, tool: "get_metrics", query: "", reason: "Inspect metrics" };
      tape.push({ schema: z.toJSONSchema(schema), system, prompt: input, output });
      return schema.parse(output);
    } };
    const production = await investigate({ input: { service: c.alert.service, symptoms: c.alert.symptoms, raw_context: "" }, alertAt: c.alert.at,
      adapter: new FixtureAdapter(visibleEvidence(c), c.alert.at), allowInternalKb: false, modelClient: recording });
    // JSON round-trip mirrors a stored model tape; timing differences cannot affect prompts.
    const saved = JSON.parse(JSON.stringify(tape)) as typeof tape;
    let cursor = 0;
    const replay: EvalModel = { async call<T>(schema: z.ZodType<T>, system: string, prompt: string) {
      const recorded = saved[cursor++];
      expect({ schema: z.toJSONSchema(schema), system, prompt: JSON.parse(prompt) }).toEqual({ schema: recorded.schema, system: recorded.system, prompt: recorded.prompt });
      return schema.parse(recorded.output);
    } };
    const trial = plannedTrials(manifest, cases)[0];
    const checkpoints: unknown[] = [];
    await generateTrial(trial, c, manifest, replay, () => checkpoints.push(structuredClone(trial)));
    expect(cursor).toBe(saved.length);
    expect(trial.diagnosis).toEqual(production.diagnosis);
    expect(trial.evidence).toEqual(production.evidence);
    expect(trial.decisions).toEqual(production.decisions);
    expect(trial.stop_reason).toBe(production.stop_reason);
    expect(production.stop_reason).toBe(stop);
    expect(production.engine_version).toBe(INVESTIGATION_ENGINE_VERSION);
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(production.analysis.severity).toBeNull();
    trial.status = "succeeded";
    const replayed = await replayProductionTrial(manifest, cases, trial);
    expect(replayed.analysis).toEqual(production.analysis);
    await expect(replayProductionTrial({ ...manifest, prompt_hash: "changed" }, cases, trial)).rejects.toThrow(/prompts changed/);
    await expect(replayProductionTrial({ ...manifest, schema_hash: "changed" }, cases, trial)).rejects.toThrow(/schemas changed/);
    await expect(replayProductionTrial(manifest, cases, { ...trial, evidence: [] })).rejects.toThrow(/differs/);
    await expect(replayProductionTrial({ ...manifest, engine_version: "experimental-eval-v2" }, cases, trial)).rejects.toThrow(/shared-engine/);
    await expect(replayProductionTrial({ ...manifest, engine_version: "shared-investigator-v1" }, cases, trial)).rejects.toThrow(/shared-engine/);
    await expect(replayProductionTrial({ ...manifest, engine_version: "shared-investigator-v2" }, cases, trial)).rejects.toThrow(/shared-engine/);
  });
});
