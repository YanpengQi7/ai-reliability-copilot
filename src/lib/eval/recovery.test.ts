import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, writeJson } from "./artifacts";
import { parseEvalFlags, validateEvalFlags } from "./cliConfig";
import { Budget } from "./provider";
import { ManifestSchema, type Trial, type Judgment } from "./contracts";

const budget = { max_usd: 1, per_call_usd: 1, max_calls: 10, max_minutes: 10, max_output_tokens: 100, input_per_million: 1, output_per_million: 1, judge_input_per_million: 1, judge_output_per_million: 1 };
const manifest = ManifestSchema.parse({ version: "eval-v2", id: "recovery", created_at: "now", git_sha: "sha", dirty: false, source_hash: "source", dataset_hash: "dataset", prompt_hash: "prompt", schema_hash: "schema", rubric_hash: "rubric", policy_version: "impact-v2", model: "mock", judge_model: "mock", modes: ["workflow"], languages: ["en"], repeats: 1, seed: 1, budget, case_ids: ["case"], protocol: { min_families: 2, noninferiority_margin: 0.05, max_cost_ratio: 2 } });
const pending: Trial = { id: "trial", case_id: "case", family: "family", mode: "workflow", language: "en", repeat: 0, status: "pending", input: { service: "svc", symptoms: "error", at: "2026-09-01T00:00:00.000Z" }, evidence: [], diagnosis: null, trace: [], calls: [], elapsed_ms: 0, failure: null, stop_reason: "pending" };

function withStore(run: (store: ArtifactStore) => void) {
  const root = mkdtempSync(join(tmpdir(), "eval-recovery-"));
  try { run(new ArtifactStore(root)); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("durable evaluation recovery", () => {
  it("does not recreate missing files when reading or initializing an existing run", () => withStore(store => {
    store.initialize(manifest, [pending]);
    store.saveTrial({ ...pending, status: "failed", failure: "provider failed" });
    unlinkSync(store.trialPath(pending.id));
    store.initialize(manifest, [pending]);
    expect(store.trialOrMissing(pending).stop_reason).toBe("missing_artifact");
    expect(existsSync(store.trialPath(pending.id))).toBe(false);
  }));
  it("initializes empty accounting and never recreates a lost ledger", () => withStore(store => {
    store.initialize(manifest, [pending]);
    expect(store.ledger()).toEqual([]);
    unlinkSync(join(store.root, "ledger.json"));
    store.initialize(manifest, [pending]);
    expect(() => store.ledger()).toThrow(/Prior spending cannot be assumed to be zero/);
    expect(existsSync(join(store.root, "ledger.json"))).toBe(false);
  }));
  it("preserves an orphan ledger instead of resetting spending during initialization", () => withStore(store => {
    const path = join(store.root, "ledger.json");
    const entries = [{ id: "1", owner: "trial", purpose: "generation", state: "reserved", reservation_usd: 0.25, usage: null, at: "2026-09-29T00:00:00.000Z" }];
    writeJson(path, entries);
    expect(() => store.initialize(manifest, [pending])).toThrow(/initialization is incomplete/);
    expect(store.ledger()).toEqual(entries);
    expect(existsSync(join(store.root, "manifest.json"))).toBe(false);
  }));
  it("rejects a malformed persisted ledger on read", () => withStore(store => {
    store.initialize(manifest, [pending]);
    writeJson(join(store.root, "ledger.json"), [{ reservation_usd: -1 }]);
    expect(() => store.ledger()).toThrow();
  }));
  it.each(["failed", "interrupted", "budget_skipped"] as const)("refuses to silently retry a %s trial", status => withStore(store => {
    store.initialize(manifest, [pending]);
    const finished = { ...pending, status };
    store.saveTrial(finished);
    store.saveTrial(finished); // Idempotent save is allowed.
    expect(() => store.saveTrial({ ...pending, status: "running" })).toThrow(/immutable/);
    expect(store.trial(pending.id).status).toBe(status);
  }));
  it("allows checkpoints, then freezes successful responses and failed judgments", () => withStore(store => {
    store.initialize(manifest, [pending]);
    store.saveTrial({ ...pending, status: "running", stop_reason: "step_cap" });
    const completed: Trial = { ...pending, status: "succeeded", diagnosis: { summary: "Unknown", conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "No scope", root_causes: [], claims: [], mitigation_plan: [], missing_information: ["scope"] } };
    store.saveTrial(completed);
    expect(() => store.saveTrial({ ...completed, elapsed_ms: 123 })).toThrow(/immutable/);
    const judgment: Judgment = { trial_id: pending.id, trial_hash: "hash", judge_run_id: "primary", judge_model: "mock", prompt_hash: "hash", status: "failed", verdict: null, calls: [], failure: "timeout" };
    store.saveJudgment(judgment); store.saveJudgment(judgment);
    expect(() => store.saveJudgment({ ...judgment, failure: "new attempt" })).toThrow(/immutable/);
    store.saveJudgment({ ...judgment, judge_run_id: "explicit-retry" });
  }));
  it("rejects negative reservations without changing the spending ledger", () => {
    const ledger: ConstructorParameters<typeof Budget>[1] = [];
    const meter = new Budget(budget, ledger, () => {});
    expect(() => meter.reserve("trial", "judge", -1)).toThrow();
    expect(ledger).toEqual([]);
    expect(ManifestSchema.safeParse({ ...manifest, budget: { ...budget, judge_input_per_million: -1 } }).success).toBe(false);
  });
});

describe("explicit CLI configuration", () => {
  it.each(["--live=false", "--mock=", "--max-usd", "--max-usd=", "--model=", "--unknown=x"])("rejects ambiguous argument %s", arg => {
    expect(() => parseEvalFlags([arg])).toThrow();
  });
  it("rejects mixed execution modes and ignored resume settings", () => {
    expect(() => parseEvalFlags(["--mock", "--live"])).toThrow();
    expect(() => validateEvalFlags("generate", parseEvalFlags(["--max-usd=9"]), true)).toThrow(/saved manifest/);
    expect(() => validateEvalFlags("report", parseEvalFlags(["--judge-model=other"]), true)).toThrow(/saved --judge-run/);
    expect(() => validateEvalFlags("score", parseEvalFlags(["--export-public"]), true)).toThrow(/does not export/);
    expect(() => validateEvalFlags("score", parseEvalFlags(["--judge-model=other", "--judge-input-price=1"]), true)).not.toThrow();
    expect(() => validateEvalFlags("generate", parseEvalFlags(["--mock", "--id=recovery"]), true)).not.toThrow();
  });
});
