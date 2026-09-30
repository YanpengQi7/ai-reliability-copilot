import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, hash, writeJson } from "./artifacts";
import { ManifestSchema, type Judgment } from "./contracts";
import { alertEvidence, loadDataset, visibleEvidence } from "./dataset";
import { plannedTrials } from "./engine";
import { compareRuns, comparisonMarkdown, loadComparisonRun, type ComparisonRun } from "./comparison";
import { INVESTIGATION_ENGINE_VERSION } from "../agent/runtime";

const cases = loadDataset("evals/datasets/sre-v2/cases.json").slice(0, 3);
function fixture(id: string, accepted = [true, true, true], repeats = 1): ComparisonRun {
  const manifest = ManifestSchema.parse({ version: "eval-v2", engine_version: INVESTIGATION_ENGINE_VERSION, id, created_at: "now", git_sha: "sha", dirty: false, source_hash: id, dataset_hash: hash(cases), prompt_hash: "prompt", schema_hash: "schema", rubric_hash: "rubric", policy_version: "impact-v2", thinking: "disabled", model: "fixture-model", judge_model: "fixture-judge", modes: ["full"], languages: ["en"], repeats, seed: 17, budget: { max_usd: 1, per_call_usd: 1, max_calls: 100, max_minutes: 10, max_output_tokens: 100, input_per_million: 1, output_per_million: 1, judge_input_per_million: 1, judge_output_per_million: 1 }, case_ids: cases.map(c => c.id), protocol: { min_families: 2, noninferiority_margin: 0.05, max_cost_ratio: 2 } });
  const trials = plannedTrials(manifest, cases).map(plan => {
    const c = cases.find(c => c.id === plan.case_id)!;
    const evidence = [alertEvidence(c), ...visibleEvidence(c)];
    return { ...plan, status: "succeeded" as const, evidence, diagnosis: { summary: "Fixture diagnosis", conclusion_status: "supported" as const, severity: c.gold.acceptable_severities[0], severity_reasoning: "Fixture scope", root_causes: [{ hypothesis: "Fixture cause", supporting_ids: [evidence[1].id], refuting_ids: [], missing_evidence: [], next_check: "Verify" }], claims: [{ id: "c1", text: "Fixture fact", kind: "observed" as const, evidence_ids: [evidence[1].id] }], mitigation_plan: [], missing_information: [] }, calls: [{ input: 1, output: 1, model: "fixture-model", purpose: "generation" as const, cost_usd: 0.01 }] };
  });
  const score = { score: 5, reasoning: "Test fixture, not an actual quality assessment" };
  const judgments: Judgment[] = trials.map(trial => ({ trial_id: trial.id, trial_hash: hash(trial), judge_model: manifest.judge_model, prompt_hash: manifest.rubric_hash, judge_run_id: "primary", status: "succeeded", calls: [], failure: null, verdict: { core: { specificity: score, safety: score, actionability: score, domain_correctness: score, completeness: score, overall_notes: "Fixture" }, root_cause_acceptable: accepted[cases.findIndex(c => c.id === trial.case_id)], uncertainty_appropriate: true, prohibited_action: false, unsupported_claim_ids: [], critical_unsupported: false, reasoning: "Fixture" } }));
  return { manifest, cases, trials, judgments, ledger: [], judge_run: "primary", judge_thinking: "disabled" };
}

describe("paired comparisons between saved runs", () => {
  it("identifies fixes, regressions and persistent failures with case-level reasons", () => {
    const result = compareRuns(fixture("baseline", [false, true, false]), fixture("candidate", [true, false, false]));
    expect(result.complete).toBe(true);
    expect(result.modes.full).toMatchObject({ planned: 3, fixed: 1, regressed: 1, persistent_failures: 1, paired_assessed: 3 });
    expect(result.changes.find(p => p.transition === "regressed")?.candidate_reasons).toContain("root_cause");
    expect(result.persistent_failures).toHaveLength(1);
    expect(result.modes.full.interval.delta).toBe(0);
    expect(result.modes.full.baseline_family_success_rate).toBeCloseTo(1 / 3);
    expect(result.modes.full.candidate_family_success_rate).toBeCloseTo(1 / 3);
    expect(result.modes.full.family_results[0]).toMatchObject({ family: cases[1].family, delta: -1, candidate_failure_reasons: { root_cause: 1 } });
    expect(result.changed_configuration).toEqual(["source_hash"]);
    expect(comparisonMarkdown(result)).toContain("persistent_failure");
    expect(JSON.stringify(result)).not.toContain("Fixture diagnosis");
  });
  it("keeps missing trials and stale judgments unassessed instead of fabricating fixes", () => {
    const baseline = fixture("baseline", [false, true, true]), candidate = fixture("candidate");
    candidate.trials = candidate.trials.slice(1);
    candidate.judgments[1].trial_hash = "stale";
    const result = compareRuns(baseline, candidate);
    expect(result.complete).toBe(false);
    expect(result.modes.full).toMatchObject({ planned: 3, paired_assessed: 1, unassessed: 2, fixed: 0, regressed: 0 });
    expect(result.modes.full.inference_ready).toBe(false);
    expect(result.changes.every(p => p.transition === "unassessed")).toBe(true);
    expect(result.modes.full.candidate_family_coverage).toBeCloseTo(1 / 3);
    expect(result.modes.full.family_results.filter(f => f.delta === null)).toHaveLength(2);
    expect(result.modes.full.family_results.find(f => f.family === cases[1].family)?.candidate_unassessed_reasons).toEqual({ unscored_or_stale: 1 });
  });
  it("reassesses candidates with the same integrity gate used by production and reports", () => {
    const candidate = fixture("candidate");
    candidate.trials[0].diagnosis!.claims[0].evidence_ids = ["fabricated"];
    candidate.judgments[0].trial_hash = hash(candidate.trials[0]);
    const result = compareRuns(fixture("baseline"), candidate);
    expect(result.modes.full.regressed).toBe(1);
    expect(result.changes[0].candidate_reasons).toContain("invalid_claim");
  });
  it("highlights new safety failures even when overall success does not change", () => {
    const baseline = fixture("baseline", [false, true, true]), candidate = fixture("candidate", [false, true, true]);
    candidate.judgments[0].verdict!.prohibited_action = true;
    const result = compareRuns(baseline, candidate);
    expect(result.modes.full).toMatchObject({ regressed: 0, persistent_failures: 1, new_safety_failures: 1 });
    expect(result.safety_regressions[0]).toMatchObject({ transition: "persistent_failure", introduced_reasons: ["prohibited_action"], resolved_reasons: [] });
    expect(comparisonMarkdown(result)).toContain("New safety failures: 1");
  });
  it("refuses dataset, judge and protocol mismatches", () => {
    const baseline = fixture("baseline");
    for (const field of ["dataset_hash", "judge_model", "rubric_hash"] as const) {
      const candidate = fixture("candidate"); candidate.manifest[field] = "different";
      expect(() => compareRuns(baseline, candidate)).toThrow(/Incompatible comparison/);
    }
    const candidate = fixture("candidate"); candidate.judge_thinking = "provider_default";
    expect(() => compareRuns(baseline, candidate)).toThrow(/judge protocol/);
    candidate.judge_thinking = "disabled"; candidate.manifest.protocol.min_families = 3;
    expect(() => compareRuns(baseline, candidate)).toThrow(/protocol differs/);
  });
  it("refuses changed trial matrices, forged snapshots and wrong judge-run assignments", () => {
    const baseline = fixture("baseline"), candidate = fixture("candidate");
    candidate.manifest.languages.push("zh");
    expect(() => compareRuns(baseline, candidate)).toThrow(/trial matrix/);
    candidate.manifest.languages = ["en"]; candidate.cases = [{ ...cases[0], category: "changed" }, ...cases.slice(1)];
    expect(() => compareRuns(baseline, candidate)).toThrow(/dataset differs/);
    candidate.cases = cases; candidate.judgments[0].judge_run_id = "other";
    expect(() => compareRuns(baseline, candidate)).toThrow(/different judge-run/);
  });
  it("does not turn repeats into independent families or draft labels into reviewed results", () => {
    const result = compareRuns(fixture("baseline", [true, true, true], 4), fixture("candidate", [true, true, true], 4));
    expect(result.modes.full).toMatchObject({ paired_assessed: 12, scope: "unreviewed_exploration", inference_ready: false });
    expect(result.modes.full.interval.families).toBe(new Set(cases.map(c => c.family)).size);
  });
  it("discloses changed generation settings and does not promote mock comparisons", () => {
    const baseline = fixture("baseline"), candidate = fixture("candidate");
    candidate.manifest.model = "mock"; candidate.manifest.ablation = "no_kb";
    const result = compareRuns(baseline, candidate);
    expect(result.changed_configuration).toEqual(["source_hash", "model", "ablation"]);
    expect(result.modes.full.scope).toBe("mock_plumbing");
    expect(result.modes.full.inference_ready).toBe(false);
  });
  it("withholds cost deltas when reservations or per-trial usage are unresolved", () => {
    const baseline = fixture("baseline"), candidate = fixture("candidate");
    candidate.ledger = [{ id: "orphan", owner: "lost", purpose: "generation", state: "reserved", reservation_usd: 0.25, usage: null, at: "2026-09-29T00:00:00.000Z" }];
    const result = compareRuns(baseline, candidate);
    expect(result.modes.full.generation_cost_delta_usd).toBeNull();
    expect(result.accounting.candidate?.accounted_cost_usd).toBe(0.25);
    candidate.ledger = []; candidate.trials[0].calls[0].cost_usd = null;
    candidate.judgments[0].trial_hash = hash(candidate.trials[0]);
    expect(compareRuns(baseline, candidate).modes.full.generation_cost_delta_usd).toBeNull();
  });
});

describe("comparison artifact reader", () => {
  it("requires idle runs and original accounting and never recreates missing trials", () => {
    const root = mkdtempSync(join(tmpdir(), "copilot-comparison-"));
    try {
      const run = fixture("saved"), store = new ArtifactStore(root);
      store.initialize(run.manifest, run.trials);
      writeJson(join(root, "dataset.json"), run.cases);
      for (const judgment of run.judgments) store.saveJudgment(judgment);
      writeJson(join(root, "judgments", "primary", "config.json"), { model: run.manifest.judge_model, prompt_hash: run.manifest.rubric_hash, thinking: "disabled", input_price: 1, output_price: 1 });
      unlinkSync(store.trialPath(run.trials[0].id));
      const before = readdirSync(join(root, "trials"));
      const loaded = loadComparisonRun(root);
      expect(loaded.trials[0].stop_reason).toBe("missing_artifact");
      expect(compareRuns(loaded, loaded).modes.full.unassessed).toBe(1);
      expect(readdirSync(join(root, "trials"))).toEqual(before);
      writeFileSync(join(root, ".lock"), "");
      expect(() => loadComparisonRun(root)).toThrow(/active or locked/);
      unlinkSync(join(root, ".lock")); unlinkSync(join(root, "ledger.json"));
      expect(() => loadComparisonRun(root)).toThrow(/ledger is missing/);
      writeJson(join(root, "ledger.json"), []);
      unlinkSync(join(root, "judgments", "primary", "config.json"));
      expect(() => loadComparisonRun(root)).toThrow(/judge configuration is missing/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
