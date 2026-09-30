import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ArtifactStore, hash, safeId } from "./artifacts";
import type { LedgerEntry } from "./accounting";
import type { EvalCase, Manifest, Trial, Judgment } from "./contracts";
import { validateDataset } from "./dataset";
import { plannedTrials } from "./engine";
import { buildReport } from "./report";
import { pairedClusterInterval } from "./statistics";

export type ComparisonRun = {
  manifest: Manifest; cases: EvalCase[]; trials: Trial[]; judgments: Judgment[];
  ledger: LedgerEntry[]; judge_run: string; judge_thinking: Manifest["thinking"];
};
const JudgeConfigSchema = z.object({ model: z.string().min(1), prompt_hash: z.string().min(1), thinking: z.enum(["disabled", "provider_default"]), input_price: z.number().nonnegative(), output_price: z.number().nonnegative() });

/** Reads immutable inputs; missing trials stay missing and spending cannot be assumed zero. */
export function loadComparisonRun(root: string, judgeRun = "primary"): ComparisonRun {
  safeId(judgeRun);
  const lock = join(root, ".lock");
  if (existsSync(lock)) throw new Error("Run is active or locked; compare only idle saved runs");
  const store = new ArtifactStore(root), original = store.manifest();
  const cases = validateDataset(JSON.parse(readFileSync(join(root, "dataset.json"), "utf8")));
  const configPath = join(root, "judgments", judgeRun, "config.json");
  const config = existsSync(configPath) ? JudgeConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8"))) : null;
  const manifest = { ...original, judge_model: config?.model ?? original.judge_model, rubric_hash: config?.prompt_hash ?? original.rubric_hash };
  const plans = plannedTrials(manifest, cases);
  const trials = plans.map(plan => store.trialOrMissing(plan));
  const judgments = plans.map(plan => store.judgment(plan.id, judgeRun)).filter((j): j is Judgment => j !== null);
  if (!config && judgments.length) throw new Error("Saved judge configuration is missing; restore it before comparing runs");
  const ledger = store.ledger();
  if (existsSync(lock)) throw new Error("Run became active during comparison; retry after it finishes");
  return { manifest, cases, trials, judgments, ledger, judge_run: judgeRun, judge_thinking: config?.thinking ?? original.thinking };
}

export function compareRuns(baseline: ComparisonRun, candidate: ComparisonRun) {
  const a = baseline.manifest, b = candidate.manifest;
  for (const run of [baseline, candidate]) {
    validateDataset(run.cases);
    if (run.judgments.some(j => j.judge_run_id !== run.judge_run)) throw new Error("Judgment belongs to a different judge-run");
  }
  for (const key of ["dataset_hash", "policy_version", "protocol"] as const) {
    if (hash(a[key]) !== hash(b[key])) throw new Error(`Incompatible comparison: ${key} differs`);
  }
  if (a.judge_model !== b.judge_model || a.rubric_hash !== b.rubric_hash || baseline.judge_thinking !== candidate.judge_thinking) throw new Error("Incompatible comparison: judge protocol differs; re-score fixed answers with the same judge configuration");
  const baselineReport = buildReport(a, baseline.cases, baseline.trials, baseline.judgments, baseline.ledger);
  const candidateReport = buildReport(b, candidate.cases, candidate.trials, candidate.judgments, candidate.ledger);
  const baselineRows = baselineReport.trial_outcomes, candidateRows = candidateReport.trial_outcomes;
  const assignments = (rows: typeof baselineRows) => rows.map(({ id, case_id, family, mode, language, repeat }) => ({ id, case_id, family, mode, language, repeat })).sort((x, y) => x.id.localeCompare(y.id));
  if (new Set(baselineRows.map(r => r.id)).size !== baselineRows.length || new Set(candidateRows.map(r => r.id)).size !== candidateRows.length) throw new Error("Duplicate planned trial assignment");
  if (hash(assignments(baselineRows)) !== hash(assignments(candidateRows))) throw new Error("Incompatible comparison: planned trial matrix differs");
  const byCandidate = new Map(candidateRows.map(r => [r.id, r]));
  const category = new Map(baseline.cases.map(c => [c.id, c.category]));
  const pairs = baselineRows.map(row => {
    const other = byCandidate.get(row.id)!;
    const transition = row.success === null || other.success === null ? "unassessed" : row.success === other.success ? row.success ? "stable_success" : "persistent_failure" : other.success ? "fixed" : "regressed";
    const introduced = transition === "unassessed" ? [] : other.reasons.filter(reason => !row.reasons.includes(reason));
    const resolved = transition === "unassessed" ? [] : row.reasons.filter(reason => !other.reasons.includes(reason));
    return { id: row.id, case_id: row.case_id, family: row.family, category: category.get(row.case_id)!, mode: row.mode, language: row.language, repeat: row.repeat,
      baseline_success: row.success, candidate_success: other.success, transition,
      baseline_reasons: row.reasons, candidate_reasons: other.reasons, introduced_reasons: introduced, resolved_reasons: resolved,
      new_safety_failure: introduced.some(reason => ["prohibited_action", "critical_unsupported"].includes(reason)) };
  });
  const mock = a.model === "mock" || b.model === "mock";
  const reviewed = !baselineReport.draft_labels && !candidateReport.draft_labels && baselineReport.calibrated && candidateReport.calibrated;
  const summarize = (selected: typeof pairs) => {
    const assessed = selected.filter(p => p.transition !== "unassessed");
    const interval = pairedClusterInterval(assessed.map(p => ({ family: p.family, a: Number(p.baseline_success), b: Number(p.candidate_success) })), a.seed);
    return { planned: selected.length, paired_assessed: assessed.length, pair_coverage: selected.length ? assessed.length / selected.length : 0,
      fixed: selected.filter(p => p.transition === "fixed").length, regressed: selected.filter(p => p.transition === "regressed").length,
      persistent_failures: selected.filter(p => p.transition === "persistent_failure").length, stable_successes: selected.filter(p => p.transition === "stable_success").length,
      new_safety_failures: selected.filter(p => p.new_safety_failure).length,
      unassessed: selected.length - assessed.length, interval,
      scope: mock ? "mock_plumbing" : !reviewed ? "unreviewed_exploration" : "reviewed_comparison",
      inference_ready: !mock && reviewed && selected.length > 0 && assessed.length === selected.length && interval.families >= a.protocol.min_families };
  };
  const modes = Object.fromEntries(a.modes.map(mode => {
    const left = baselineReport.modes[mode], right = candidateReport.modes[mode];
    const knownCost = left.cost_complete && right.cost_complete && baselineReport.accounting!.complete && candidateReport.accounting!.complete;
    const leftFamilies = new Map(left.family_results.map(f => [f.family, f]));
    const familyResults = right.family_results.map(f => {
      const before = leftFamilies.get(f.family)!;
      return { family: f.family, case_ids: f.case_ids,
        baseline_success_rate: before.success_rate, candidate_success_rate: f.success_rate,
        baseline_coverage: before.coverage, candidate_coverage: f.coverage,
        delta: before.unassessed === 0 && f.unassessed === 0 ? f.success_rate - before.success_rate : null,
        baseline_failure_reasons: before.failure_reasons, candidate_failure_reasons: f.failure_reasons,
        baseline_unassessed_reasons: before.unassessed_reasons, candidate_unassessed_reasons: f.unassessed_reasons };
    }).sort((x, y) => (x.delta ?? Infinity) - (y.delta ?? Infinity) || x.family.localeCompare(y.family));
    return [mode, { ...summarize(pairs.filter(p => p.mode === mode)), baseline_success_rate: left.success_rate, candidate_success_rate: right.success_rate,
      baseline_family_success_rate: left.family_success_rate, candidate_family_success_rate: right.family_success_rate,
      baseline_family_coverage: left.family_coverage, candidate_family_coverage: right.family_coverage,
      family_results: familyResults,
      baseline_known_generation_cost_usd: left.known_cost_usd, candidate_known_generation_cost_usd: right.known_cost_usd,
      generation_cost_delta_usd: knownCost ? right.known_cost_usd - left.known_cost_usd : null }];
  }));
  const slices = Object.fromEntries([...new Set(pairs.map(p => p.category))].map(slice => [slice, Object.fromEntries(a.modes.map(mode => [mode, summarize(pairs.filter(p => p.mode === mode && p.category === slice))]))]));
  const identity = (run: ComparisonRun) => ({ run: run.manifest.id, judge_run: run.judge_run, snapshot_hash: hash(run), engine: run.manifest.engine_version,
    git_sha: run.manifest.git_sha, dirty: run.manifest.dirty,
    source: run.manifest.source_hash, prompt: run.manifest.prompt_hash, schema: run.manifest.schema_hash, model: run.manifest.model,
    thinking: run.manifest.thinking, ablation: run.manifest.ablation, budget: run.manifest.budget, seed: run.manifest.seed });
  const changed = (["engine_version", "source_hash", "prompt_hash", "schema_hash", "model", "thinking", "ablation", "budget", "seed"] as const).filter(key => hash(a[key]) !== hash(b[key]));
  return { version: "run-comparison-v1", baseline: identity(baseline), candidate: identity(candidate), changed_configuration: changed,
    dataset_hash: a.dataset_hash, judge: { model: a.judge_model, rubric: a.rubric_hash, thinking: baseline.judge_thinking },
    complete: pairs.every(p => p.transition !== "unassessed"), modes, slices,
    changes: pairs.filter(p => ["fixed", "regressed", "unassessed"].includes(p.transition)),
    persistent_failures: pairs.filter(p => p.transition === "persistent_failure"),
    safety_regressions: pairs.filter(p => p.new_safety_failure),
    accounting: { baseline: baselineReport.accounting, candidate: candidateReport.accounting },
    note: "Reassessed under the current evaluator. This comparison is not a release gate or proof of causality. Missing or stale assessments remain unassessed. Intervals weight incident families equally; repeats and languages are not independent samples. Costs are as recorded, not invoices. Changed configurations can confound attribution. Mock runs verify plumbing only." };
}

export function comparisonMarkdown(comparison: ReturnType<typeof compareRuns>) {
  const priority: Record<string, number> = { regressed: 1, unassessed: 2, persistent_failure: 3, fixed: 4 };
  const details = [...comparison.changes, ...comparison.persistent_failures].sort((a, b) => (a.new_safety_failure ? 0 : priority[a.transition]) - (b.new_safety_failure ? 0 : priority[b.transition]) || a.id.localeCompare(b.id));
  return [`# Evaluation comparison: ${comparison.baseline.run} → ${comparison.candidate.run}`, `\n${comparison.note}`,
    `\nComplete paired coverage: ${comparison.complete}. Changed configuration: ${comparison.changed_configuration.join(", ") || "none"}.`,
    `\nNew safety failures: ${comparison.safety_regressions.length}. These can occur even when a case failed in both versions.`,
    "\n| Mode | Paired / planned | Fixed | Regressed | Persistent failures | Family delta (95% interval) | Cost delta (USD) | Scope |",
    "|---|---:|---:|---:|---:|---|---|---|",
    ...Object.entries(comparison.modes).map(([mode, s]) => `| ${mode} | ${s.paired_assessed} / ${s.planned} | ${s.fixed} | ${s.regressed} | ${s.persistent_failures} | ${s.interval.delta ?? "unknown"} (${s.interval.lower ?? "unknown"}, ${s.interval.upper ?? "unknown"}) | ${s.generation_cost_delta_usd ?? "unknown"} | ${s.scope} |`),
    "\n| Mode | Baseline family success | Candidate family success | Baseline family coverage | Candidate family coverage |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(comparison.modes).map(([mode, s]) => `| ${mode} | ${s.baseline_family_success_rate ?? "unknown"} | ${s.candidate_family_success_rate ?? "unknown"} | ${s.baseline_family_coverage ?? "unknown"} | ${s.candidate_family_coverage ?? "unknown"} |`),
    "\nFamily success uses all planned trials and weights families equally. Per-family deltas require complete coverage in both runs; missing assessments are not regressions. Family details and failure reasons are in the companion JSON.",
    "\n## Cases to inspect\n", ...details.slice(0, 30).map(p => `- ${p.id}: ${p.transition}. Baseline: ${p.baseline_reasons.join(", ") || "accepted"}. Candidate: ${p.candidate_reasons.join(", ") || "accepted"}.`),
    details.length ? `\nAll ${details.length} case transitions and failure reasons are in the companion JSON.` : "No fixes, regressions, missing assessments or persistent failures.",
  ].join("\n");
}
