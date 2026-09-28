import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkClaims, evidenceItem, type Claim } from "../agent/evidence";
import { FixtureAdapter, loadDataset, validateDataset } from "./dataset";
import { pairedClusterInterval } from "./statistics";
import { Budget, BudgetExceeded } from "./provider";
import { ArtifactStore, hash } from "./artifacts";
import { ManifestSchema, type Trial } from "./contracts";
import { plannedTrials, scoreTrial, judgeInput } from "./engine";
import { buildReport } from "./report";
import { severityForImpact } from "./severityPolicy";
import { calibrationPack, summarizeCalibration } from "./calibration";
import { dispatchTool } from "../agent/tools";

const cases = loadDataset("evals/datasets/sre-v2/cases.json");
const budgetConfig = { max_usd: 1, per_call_usd: 0.5, max_calls: 100, max_minutes: 20, max_output_tokens: 100, input_per_million: 1, output_per_million: 1, judge_input_per_million: 1, judge_output_per_million: 1 };
const manifest = ManifestSchema.parse({ version: "eval-v2", id: "test", created_at: "now", git_sha: "abc", dirty: false, source_hash: "a", dataset_hash: hash(cases), prompt_hash: "a", schema_hash: "a", rubric_hash: "a", policy_version: "impact-v2", model: "mock", judge_model: "mock", modes: ["workflow", "agentic"], languages: ["en"], repeats: 1, seed: 17, budget: budgetConfig, case_ids: cases.map(c => c.id), protocol: { min_families: 10, noninferiority_margin: 0.05, max_cost_ratio: 2 } });
const at = "2026-09-01T10:00:00.000Z";
const evidence = evidenceItem({ id: "metric1", kind: "metric", source: "fixture", service: "orders", observed_at: at, available_at: at, text: "orders success 96.8%", measurement: { metric: "success", value: 96.8, unit: "%", window: "5m" } });

describe("claim grounding", () => {
  it("defers prose measurements and qualitative inference to semantic review", () => {
    const prose = { ...evidence, measurement: undefined };
    const claim: Claim = { id: "c", kind: "observed", text: "orders success 96.8%", evidence_ids: ["metric1"], measurement: { service: "orders", metric: "success", value: 96.8, unit: "%", window: "5m" } };
    expect(checkClaims([claim], [prose])[0]).toMatchObject({ errors: [], semantic_review_required: true });
    expect(checkClaims([{ ...claim, kind: "inference", measurement: undefined }], [prose])[0].errors).toEqual([]);
    expect(checkClaims([{ ...claim, measurement: { ...claim.measurement!, service: "payments" } }], [prose])[0].errors).toContain("measurement_mismatch");
    expect(checkClaims([{ ...claim, kind: "derived", derivation: { operation: "complement_percent", operands: ["96.8"], value: 3.2, unit: "%" } }], [prose])[0].errors).toContain("invalid_derivation");
  });
  it("calibration mutations include supported derivations and contextual false positives", () => {
    const pack = calibrationPack();
    expect(pack).toHaveLength(30);
    for (const sample of pack) {
      const errors = checkClaims(sample.trial.diagnosis!.claims, sample.trial.evidence).flatMap(c => c.errors);
      expect(errors.length > 0).toBe(sample.expected_unsupported);
    }
    const summary = summarizeCalibration(pack, [], [], "test-judge", "live");
    expect(summary.reviewed).toBe(false);
    expect(summary.n).toBe(0);
    expect(summary.recall).toBeNull();
  });
  it("rejects the same number attributed to a different service", () => {
    const claim: Claim = { id: "c", kind: "observed", text: "payments success 96.8%", evidence_ids: ["metric1"], measurement: { service: "payments", metric: "success", value: 96.8, unit: "%", window: "5m" } };
    expect(checkClaims([claim], [evidence])[0].errors).toContain("measurement_mismatch");
  });
  it("accepts explicit supported arithmetic and rejects bad units", () => {
    const claim: Claim = { id: "c", kind: "derived", text: "Failure rate 3.2%", evidence_ids: ["metric1"], derivation: { operation: "complement_percent", operands: ["metric1"], value: 3.2, unit: "%" } };
    expect(checkClaims([claim], [evidence])[0].errors).toEqual([]);
    claim.derivation!.unit = "ms";
    expect(checkClaims([claim], [evidence])[0].errors).toContain("invalid_arithmetic");
  });
});
describe("dataset and replay", () => {
  it("has 30 draft candidates, no false gold labels", () => {
    expect(cases).toHaveLength(30);
    expect(cases.every(c => c.gold.review_status === "draft")).toBe(true);
  });
  it("rejects family leakage and invisible required evidence", () => {
    expect(() => validateDataset([cases[0], { ...cases[0], id: "copy", split: "test" }])).toThrow(/leaks/);
    expect(() => validateDataset([{ ...cases[0], gold: { ...cases[0].gold, required_evidence_ids: ["future"] } }])).toThrow(/unavailable/);
  });
  it("cannot retrieve future evidence or cross-service metrics", async () => {
    const adapter = new FixtureAdapter([evidence, { ...evidence, id: "future", available_at: "2027-01-01T00:00:00.000Z" }], at);
    expect(await adapter.read("get_metrics", { service: "payments" })).toEqual([]);
    expect((await adapter.read("get_metrics", { service: "orders" })).map(e => e.id)).toEqual(["metric1"]);
    await expect(adapter.read("execute_rollback", {})).rejects.toThrow(/read-only/i);
  });
  it("blocks private KB reads for anonymous analysis callers", async () => {
    const result = await dispatchTool(1, "search_runbooks", { query: "internal production secrets" }, { ctx: { raw_context: "" }, callCounts: {}, allowInternalKb: false });
    expect(result.status).toBe("empty");
    expect(result.observation).toContain("unavailable for this caller");
  });
  it("preserves completed trials on resume and rejects manifest drift", () => {
    const root = mkdtempSync(join(tmpdir(), "copilot-eval-"));
    try {
      const store = new ArtifactStore(root), trials = plannedTrials(manifest, cases);
      store.initialize(manifest, trials);
      store.saveTrial({ ...trials[0], status: "failed", failure: "timeout" });
      store.initialize(manifest, trials);
      expect(store.trial(trials[0].id).status).toBe("failed");
      expect(() => store.initialize({ ...manifest, seed: 99 }, trials)).toThrow(/mismatch/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("scores fixed answers without a generation call or mode labels", async () => {
    const t = { ...plannedTrials(manifest, [cases[0]])[0], status: "succeeded", diagnosis: { summary: "test", conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "unknown", root_causes: [], claims: [], mitigation_plan: [], missing_information: ["scope"] } } as Trial;
    const call = vi.fn(async () => { throw new Error("judge unavailable"); });
    await expect(scoreTrial(t, cases[0], "judge2", "judge", { call })).rejects.toThrow("judge unavailable");
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]).toHaveLength(4);
    expect(JSON.parse(judgeInput(t, cases[0]))).not.toHaveProperty("mode");
  });
});
describe("failure accounting and statistics", () => {
  it("retains failed and missing judgments in the planned denominator", () => {
    const trials = plannedTrials(manifest, cases);
    trials[0].status = "failed";
    const r = buildReport(manifest, cases, trials, []);
    expect(r.modes.workflow.planned + r.modes.agentic.planned).toBe(60);
    expect(r.gate).toBe("incomplete");
    expect(r.draft_labels).toBe(true);
  });
  it("does not pretend repeats are independent incidents", () => {
    const pairs = Array.from({ length: 100 }, () => ({ family: "one", a: 0, b: 1 }));
    expect(pairedClusterInterval(pairs).lower).toBeNull();
    const x = [{ family: "one", a: 0, b: 1 }, { family: "two", a: 0, b: 1 }];
    expect(pairedClusterInterval(x)).toEqual(pairedClusterInterval(x));
    expect(pairedClusterInterval(x).lower).toBe(1);
  });
  it("refuses to forget interrupted spending reservations", () => {
    const ledger: ConstructorParameters<typeof Budget>[1] = [];
    const b = new Budget(budgetConfig, ledger, () => {});
    b.reserve("trial1", "generation", 0.5);
    const resumed = new Budget(budgetConfig, ledger, () => {});
    resumed.reserve("trial2", "generation", 0.5);
    expect(() => resumed.reserve("trial3", "judge", 0.01)).toThrow(BudgetExceeded);
  });
  it("does not treat missing duration as zero for broad impact", () => {
    expect(severityForImpact({ dataRisk: false, criticalPathDown: false, internalOnly: false, userImpactPercent: 80, durationMinutes: null })).toBeNull();
  });
});
