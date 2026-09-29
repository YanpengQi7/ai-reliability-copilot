import { describe, expect, it } from "vitest";
import { loadDataset, visibleEvidence, FixtureAdapter, validateDataset } from "./dataset";
import { evidenceItem } from "../agent/evidence";
import { hash } from "./artifacts";
import { DiagnosisSchema, ManifestSchema, TrialSchema, JudgmentSchema, type Judgment } from "./contracts";
import { calibrationPack, summarizeCalibration } from "./calibration";
import { EVAL_JUDGE_PROMPT, generateTrial, plannedTrials, type EvalModel } from "./engine";
import { buildReport } from "./report";

const cases = loadDataset("evals/datasets/sre-v2/cases.json").slice(0, 1);
const manifest = ManifestSchema.parse({ version: "eval-v2", engine_version: "shared-investigator-v1", id: "integrity", created_at: "now", git_sha: "sha", dirty: false, source_hash: "source", dataset_hash: hash(cases), prompt_hash: "prompt", schema_hash: "schema", rubric_hash: "rubric", policy_version: "impact-v2", model: "live", judge_model: "judge", modes: ["workflow", "agentic"], languages: ["en"], repeats: 1, seed: 1, budget: { max_usd: 1, per_call_usd: 1, max_calls: 10, max_minutes: 10, max_output_tokens: 100, input_per_million: 1, output_per_million: 1, judge_input_per_million: 1, judge_output_per_million: 1 }, case_ids: cases.map(c => c.id), protocol: { min_families: 2, noninferiority_margin: 0.05, max_cost_ratio: 2 } });
function success() {
  const t = plannedTrials(manifest, cases)[0];
  t.status = "succeeded";
  t.evidence = cases[0].evidence;
  t.diagnosis = { summary: "Supported", conclusion_status: "supported", severity: cases[0].gold.acceptable_severities[0], severity_reasoning: "Partial impact", root_causes: [{ hypothesis: "Pool exhaustion", supporting_ids: [t.evidence[0].id], refuting_ids: [], missing_evidence: [], next_check: "Verify recovery" }], claims: [{ id: "c1", text: "Pool exhausted", kind: "observed", evidence_ids: [t.evidence[0].id] }], mitigation_plan: [], missing_information: [] };
  if (t.mode === "agentic") {
    t.decisions = [
      { hypotheses: [], done: false, tool: "get_metrics", query: "", reason: "Inspect evidence" },
      { hypotheses: [], done: true, tool: "get_metrics", query: "", reason: "Enough evidence" },
    ];
    t.trace = [{ tool: "get_metrics", input: { service: cases[0].alert.service }, evidence_ids: t.evidence.map(e => e.id), observation: "Fixture evidence" }];
  }
  const score = { score: 5, reasoning: "test fixture" };
  const j: Judgment = { trial_id: t.id, trial_hash: hash(t), judge_model: "judge", prompt_hash: "rubric", judge_run_id: "primary", status: "succeeded", failure: null, calls: [], verdict: { core: { specificity: score, safety: score, actionability: score, domain_correctness: score, completeness: score, overall_notes: "fixture" }, root_cause_acceptable: true, uncertainty_appropriate: true, prohibited_action: false, unsupported_claim_ids: [], critical_unsupported: false, reasoning: "fixture" } };
  return { t, j };
}

describe("evaluation artifact integrity", () => {
  it("keeps alert provenance and hypothesis decisions through final synthesis", async () => {
    const prompts: Record<string, unknown>[] = [];
    const { t } = success();
    const model: EvalModel = { async call(schema, _system, prompt) {
      const input = JSON.parse(prompt); prompts.push(input);
      if (Object.is(schema, DiagnosisSchema)) return schema.parse(t.diagnosis);
      return schema.parse({ hypotheses: [{ hypothesis: "Pool exhaustion", supporting_ids: [], refuting_ids: [], missing: "Confirm saturation" }], done: input.history.length > 0, tool: "get_metrics", query: "", reason: "Inspect current metrics" });
    } };
    const trial = plannedTrials(manifest, cases).find(t => t.mode === "agentic")!;
    await generateTrial(trial, cases[0], manifest, model, () => {});
    expect(trial.evidence[0].id).toBe("alert-context");
    expect(trial.evidence[0].source).toContain("unverified");
    expect(trial.decisions).toHaveLength(2);
    expect(prompts.at(-1)?.hypotheses).toEqual(trial.decisions?.at(-1)?.hypotheses);
    const ablated = plannedTrials(manifest, cases).find(t => t.mode === "agentic")!;
    await generateTrial(ablated, cases[0], { ...manifest, ablation: "no_state" }, model, () => {});
    expect(prompts.at(-1)).not.toHaveProperty("hypotheses");
  });

  it("restores missing trials to the denominator instead of inflating success", () => {
    const { t, j } = success();
    const r = buildReport(manifest, cases, [t], [j]);
    expect(Object.values(r.modes).reduce((n, s) => n + s.planned, 0)).toBe(2);
    expect(r.gate).toBe("incomplete");
    expect(r.gate_reasons).toContain("incomplete_trial_or_judgment_coverage");
  });
  it("rejects duplicate trials, changed assignment and duplicate judgments", () => {
    const { t, j } = success();
    expect(() => buildReport(manifest, cases, [t, t], [j])).toThrow(/duplicate/);
    expect(() => buildReport(manifest, cases, [{ ...t, family: "different" }], [j])).toThrow(/changed/);
    expect(() => buildReport(manifest, cases, [t], [j, j])).toThrow(/duplicate judgment/);
  });
  it("does not accept a different judge protocol or stale response hash", () => {
    const { t, j } = success();
    const r = buildReport(manifest, cases, [t], [{ ...j, prompt_hash: "other" }]);
    expect(r.modes[t.mode].assessed).toBe(0);
    expect(r.modes[t.mode].failures[0].reasons).toContain("judge_protocol_mismatch");
    expect(buildReport(manifest, cases, [t], [{ ...j, trial_hash: "old" }]).modes[t.mode].assessed).toBe(0);
  });
  it("rejects forged snapshots even if a judge accepts the diagnosis", () => {
    const { t, j } = success();
    t.evidence = [{ ...t.evidence[0], text: "changed after retrieval" }, ...t.evidence.slice(1)];
    j.trial_hash = hash(t);
    const r = buildReport(manifest, cases, [t], [j]);
    expect(r.modes[t.mode].failures[0].reasons).toContain("invalid_evidence_snapshot");
  });
  it("does not count altered records as retrieved evidence", () => {
    const { t, j } = success();
    t.evidence = t.evidence.map(e => ({ ...e, text: "Altered observation" }));
    j.trial_hash = hash(t);
    const r = buildReport(manifest, cases, [t], [j]);
    expect(r.modes[t.mode].required_evidence).toBeGreaterThan(0);
    expect(r.modes[t.mode].retrieved_required_evidence).toBe(0);
    expect(r.modes[t.mode].evidence_coverage).toBe(0);
  });
  it("fails semantic fabrication even when citations and overall judge answers look valid", () => {
    const { t, j } = success();
    j.verdict!.unsupported_claim_ids = ["c1", "c1", "unlisted-summary-assertion"];
    const r = buildReport(manifest, cases, [t], [j]);
    expect(r.modes[t.mode].succeeded).toBe(0);
    expect(r.modes[t.mode].failures[0].reasons).toContain("unsupported_claim");
    expect(r.modes[t.mode].invalid_claims).toBe(0);
    expect(r.modes[t.mode].semantic_unsupported_claims).toBe(2);
    expect(r.modes[t.mode].trials_with_semantic_unsupported_claims).toBe(1);
    expect(r.modes[t.mode].critical_unsupported).toBe(0);
  });
  it("excludes stale semantic verdicts from grounding metrics", () => {
    const { t, j } = success();
    j.verdict!.unsupported_claim_ids = ["c1"];
    j.trial_hash = "stale";
    const r = buildReport(manifest, cases, [t], [j]);
    expect(r.modes[t.mode].semantic_unsupported_claims).toBe(0);
    expect(r.modes[t.mode].judged_trials).toBe(0);
    expect(r.modes[t.mode].assessed).toBe(0);
  });
  it("fails accepted diagnoses with planner references to evidence retrieved later", () => {
    const { t, j } = success();
    const plan = plannedTrials(manifest, cases).find(trial => trial.mode === "agentic")!;
    const trial = { ...t, ...plan, status: "succeeded" as const, evidence: t.evidence, diagnosis: t.diagnosis,
      decisions: [
        { hypotheses: [{ hypothesis: "Cause", supporting_ids: [t.evidence[0].id], refuting_ids: [], missing: "" }], done: false, tool: "get_metrics" as const, query: "", reason: "Check" },
        { hypotheses: [], done: true, tool: "get_metrics" as const, query: "", reason: "Stop" },
      ], trace: [{ tool: "get_metrics", input: {}, evidence_ids: t.evidence.map(e => e.id), observation: "Retrieved" }] };
    const judgment = { ...j, trial_id: trial.id, trial_hash: hash(trial) };
    const report = buildReport(manifest, cases, [trial], [judgment]);
    expect(report.modes.agentic.succeeded).toBe(0);
    expect(report.modes.agentic.audited_decision_trials).toBe(1);
    expect(report.modes.agentic.decision_history_errors).toBe(1);
    expect(report.modes.agentic.failures[0].reasons).toContain("invalid_decision_history");
    expect(report.modes.agentic.failures[0].decision_errors[0]).toMatchObject({ step: 1, reason: "unseen_reference" });
    const missing = { ...trial, decisions: undefined };
    const missingReport = buildReport(manifest, cases, [missing], [{ ...judgment, trial_hash: hash(missing) }]);
    expect(missingReport.modes.agentic.missing_decision_histories).toBe(1);
    expect(missingReport.modes.agentic.succeeded).toBe(0);
    const staleReport = buildReport(manifest, cases, [trial], [{ ...judgment, trial_hash: "stale" }]);
    expect(staleReport.modes.agentic.assessed).toBe(0);
    expect(staleReport.gate).toBe("incomplete");
  });
  it("counts missing required evidence and slow failures", () => {
    const { t, j } = success();
    t.evidence = []; j.trial_hash = hash(t);
    const failed = { ...plannedTrials(manifest, cases).find(p => p.id !== t.id)!, status: "failed" as const, elapsed_ms: 9000, failure: "timeout" };
    const r = buildReport(manifest, cases, [t, failed], [j]);
    expect(r.modes[t.mode].evidence_coverage).toBe(0);
    expect(r.modes[t.mode].failures[0].reasons).toContain("missing_required_evidence");
    expect(r.modes[failed.mode].attempted_p95_ms).toBe(9000);
    expect(r.modes[failed.mode].p95_ms).toBeNull();
  });
  it("cannot release equally poor arms just because their relative difference is zero", () => {
    const reviewed = [cases[0], { ...cases[0], id: "independent-case", family: "independent-family" }].map(c => ({ ...c, split: "test" as const, gold: { ...c.gold, review_status: "gold" as const, reviewers: ["a", "b"] } }));
    const m = { ...manifest, dataset_hash: hash(reviewed), case_ids: reviewed.map(c => c.id), calibration: { judge_model: "judge", prompt_hash: "rubric", pack_hash: "pack", labels_hash: "labels", n: 30, precision: 1, recall: 1, reviewed: true, execution: "live" as const } };
    const { t, j } = success();
    const trials = plannedTrials(m, reviewed).map(plan => ({ ...t, ...plan, diagnosis: t.diagnosis, evidence: t.evidence, status: "succeeded" as const, decisions: [{ hypotheses: [], done: false, tool: "get_metrics" as const, query: "", reason: "Inspect" }, { hypotheses: [], done: true, tool: "get_metrics" as const, query: "", reason: "Stop" }], trace: [{ tool: "get_metrics", input: { service: cases[0].alert.service }, evidence_ids: t.evidence.map(e => e.id), observation: "Fixture evidence" }], calls: [{ input: 1, output: 1, model: "live", purpose: "generation" as const, cost_usd: 0.001 }] }));
    const judgments = trials.map(trial => ({ ...j, trial_id: trial.id, trial_hash: hash(trial), verdict: { ...j.verdict!, root_cause_acceptable: trial.case_id === cases[0].id } }));
    const report = buildReport(m, reviewed, trials, judgments);
    expect(report.comparison?.delta).toBe(0);
    expect(report.cost_ratio).toBe(1);
    expect(report.gate).toBe("regression");
    expect(report.gate_reasons).toContain("candidate_below_absolute_success_floor");
    const passing = buildReport(m, reviewed, trials, judgments.map(j => ({ ...j, verdict: { ...j.verdict!, root_cause_acceptable: true } })));
    expect(passing.gate).toBe("passed");
    expect(passing.gate_reasons).toEqual([]);
    const legacy = buildReport({ ...m, engine_version: "experimental-eval-v2" }, reviewed, trials, judgments.map(j => ({ ...j, verdict: { ...j.verdict!, root_cause_acceptable: true } })));
    expect(legacy.gate).toBe("inconclusive");
    expect(legacy.gate_reasons).toContain("legacy_experimental_engine");
    expect(passing.dataset_splits).toEqual({ dev: 0, validation: 0, test: 2 });
    for (const splits of [["dev", "dev"], ["validation", "validation"], ["test", "dev"]] as const) {
      const exploratory = reviewed.map((c, i) => ({ ...c, split: splits[i] }));
      const exploratoryManifest = { ...m, dataset_hash: hash(exploratory) };
      const result = buildReport(exploratoryManifest, exploratory, trials, judgments.map(j => ({ ...j, verdict: { ...j.verdict!, root_cause_acceptable: true } })));
      expect(result.gate).toBe("inconclusive");
      expect(result.gate_reasons).toEqual(["non_test_dataset"]);
      expect(Object.values(result.dataset_splits).reduce((a, b) => a + b, 0)).toBe(2);
      const regression = buildReport(exploratoryManifest, exploratory, trials, judgments);
      expect(regression.gate).toBe("regression");
      expect(regression.gate_reasons).toContain("candidate_below_absolute_success_floor");
    }

    const unresolved = buildReport(m, reviewed, trials, judgments.map(j => ({ ...j, verdict: { ...j.verdict!, root_cause_acceptable: true } })), [{ id: "orphan", owner: "lost-trial", purpose: "generation", state: "reserved", reservation_usd: 0.1, usage: null, at: "2026-09-29T00:00:00.000Z" }]);
    expect(unresolved.gate).toBe("inconclusive");
    expect(unresolved.gate_reasons).toContain("unresolved_call_costs");

  });

  it("requires output for successful artifact statuses", () => {
    const { t, j } = success();
    expect(TrialSchema.safeParse({ ...t, diagnosis: null }).success).toBe(false);
    expect(JudgmentSchema.safeParse({ ...j, verdict: null }).success).toBe(false);
  });
  it("normalizes reviewer identities in judge calibration", () => {
    const pack = calibrationPack().slice(0, 1);
    const { j } = success();
    const judgment = { ...j, trial_id: pack[0].id, trial_hash: hash(pack[0].trial), prompt_hash: hash(EVAL_JUDGE_PROMPT) };
    const reviews = ["Alice", " alice "].map(reviewer => ({ sample_id: pack[0].id, reviewer, unsupported: false, notes: "unit fixture" }));
    expect(summarizeCalibration(pack, [judgment], reviews, "judge", "live").reviewed).toBe(false);
    reviews[1].reviewer = "Bob";
    expect(summarizeCalibration(pack, [judgment], reviews, "judge", "live").reviewed).toBe(true);
    const historical = summarizeCalibration(pack, [{ ...judgment, prompt_hash: "historical-rubric" }], reviews, "judge", "live", "historical-rubric");
    expect(historical.n).toBe(1);
    expect(historical.prompt_hash).toBe("historical-rubric");
  });
  it("rejects disguised duplicate reviewers", () => {
    expect(() => validateDataset([{ ...cases[0], gold: { ...cases[0].gold, review_status: "gold", reviewers: ["Alice", " alice "] } }])).toThrow(/independent/);
  });
  it("hides future observations even with an earlier availability timestamp", async () => {
    const { content_hash: _, ...raw } = cases[0].evidence[0];
    void _;
    const future = evidenceItem({ ...raw, observed_at: "2027-01-01T00:00:00.000Z" });
    expect(visibleEvidence({ ...cases[0], evidence: [future] })).toEqual([]);
    expect(await new FixtureAdapter([future], cases[0].alert.at).read("get_metrics", {})).toEqual([]);
  });
});
