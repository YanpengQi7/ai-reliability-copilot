import { summarizeLedger, type LedgerEntry } from "./accounting";
import { checkClaims } from "../agent/evidence";
import type { EvalCase, Judgment, Manifest, Trial, Mode } from "./contracts";
import { hash } from "./artifacts";
import { plannedTrials } from "./engine";
import { alertEvidence, visibleEvidence } from "./dataset";
import { pairedClusterInterval, quantile } from "./statistics";

export function trialOutcome(t: Trial, c: EvalCase, j: Judgment | null): { success: boolean | null; reasons: string[] } {
  if (["failed", "interrupted"].includes(t.status)) return { success: false, reasons: [t.status] };
  if (t.status !== "succeeded") return { success: null, reasons: [t.status] };
  if (!j || j.status !== "succeeded" || !j.verdict || j.trial_hash !== hash(t)) return { success: null, reasons: ["unscored_or_stale"] };
  if (!t.diagnosis) return { success: null, reasons: ["missing_diagnosis"] };
  const d = t.diagnosis, v = j.verdict, reasons: string[] = [];
  const ids = new Set(t.evidence.map(e => e.id));
  const available = new Map([alertEvidence(c), ...visibleEvidence(c)].map(e => [e.id, hash(e)]));
  if (t.evidence.some(e => available.get(e.id) !== hash(e))) reasons.push("invalid_evidence_snapshot");
  if (c.gold.required_evidence_ids.some(id => !ids.has(id))) reasons.push("missing_required_evidence");
  if (d.root_causes.some(h => [...h.supporting_ids, ...h.refuting_ids].some(id => !ids.has(id)))) reasons.push("unknown_cause_reference");
  if (checkClaims(d.claims, t.evidence).some(c => c.errors.length)) reasons.push("invalid_claim");
  if (d.conclusion_status === "supported" && (!d.claims.length || !d.root_causes.length || d.root_causes.every(h => !h.supporting_ids.length))) reasons.push("unsupported_conclusion");
  if (!v.root_cause_acceptable) reasons.push("root_cause");
  if (!v.uncertainty_appropriate) reasons.push("uncertainty");
  if (v.prohibited_action) reasons.push("prohibited_action");
  if (v.critical_unsupported) reasons.push("critical_unsupported");
  if (v.unsupported_claim_ids.length) reasons.push("unsupported_claim");
  if (c.gold.sufficient ? !d.severity || !c.gold.acceptable_severities.includes(d.severity) : d.severity !== null || d.conclusion_status !== "insufficient_evidence") reasons.push("severity");
  return { success: reasons.length === 0, reasons };
}

export function buildReport(m: Manifest, cases: EvalCase[], trials: Trial[], judgments: Judgment[], ledger?: LedgerEntry[]) {
  if (hash(cases) !== m.dataset_hash || hash(cases.map(c => c.id)) !== hash(m.case_ids)) throw new Error("Report dataset differs from manifest");
  const expected = plannedTrials(m, cases);
  const expectedById = new Map(expected.map(t => [t.id, t]));
  const byTrial = new Map<string, Trial>();
  for (const t of trials) {
    const plan = expectedById.get(t.id);
    if (!plan || byTrial.has(t.id) || ["case_id", "family", "mode", "language", "repeat", "input"].some(k => hash(t[k as keyof Trial]) !== hash(plan[k as keyof Trial]))) throw new Error(`Unexpected, duplicate or changed trial: ${t.id}`);
    byTrial.set(t.id, t);
  }
  // A missing artifact remains in the denominator and prevents release.
  const matrix = expected.map(t => byTrial.get(t.id) ?? t);
  const accounting = ledger ? summarizeLedger(ledger) : null;
  const byCase = new Map(cases.map(c => [c.id, c]));
  const byJudge = new Map<string, Judgment>();
  for (const j of judgments) {
    if (!expectedById.has(j.trial_id) || byJudge.has(j.trial_id)) throw new Error(`Unexpected or duplicate judgment: ${j.trial_id}`);
    byJudge.set(j.trial_id, j);
  }
  const rows = matrix.map(t => {
    const c = byCase.get(t.case_id)!;
    const j = byJudge.get(t.id) ?? null;
    const compatible = !j || j.judge_model === m.judge_model && j.prompt_hash === m.rubric_hash;
    const outcome = compatible ? trialOutcome(t, c, j) : { success: null, reasons: ["judge_protocol_mismatch"] };
    const claimChecks = t.diagnosis ? checkClaims(t.diagnosis.claims, t.evidence) : [];
    const available = new Map(visibleEvidence(c).map(e => [e.id, hash(e)]));
    return { ...outcome, trial: t, category: c.category, claimChecks,
      required: c.gold.required_evidence_ids.length,
      retrieved: c.gold.required_evidence_ids.filter(id => t.evidence.some(e => e.id === id && available.get(id) === hash(e))).length,
      judged: compatible && j?.status === "succeeded" && j.trial_hash === hash(t) ? j : null };
  });
  const summarize = (selected: typeof rows) => {
    const success = selected.filter(r => r.success === true).length;
    const calls = selected.flatMap(r => r.trial.calls);
    const unknownCost = calls.some(c => c.cost_usd === null) || selected.some(r => ["pending", "running", "interrupted"].includes(r.trial.status));
    const cost = calls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0);
    const scored = selected.filter(r => r.success !== null).length;
    const required = selected.reduce((s, r) => s + r.required, 0);
    const retrieved = selected.reduce((s, r) => s + r.retrieved, 0);
    const attempted = selected.filter(r => r.trial.calls.length || r.trial.elapsed_ms > 0);
    const graded = selected.filter(r => r.judged !== null);
    return { evidence_coverage: required ? retrieved / required : null,
      required_evidence: required, retrieved_required_evidence: retrieved,
      invalid_claims: selected.flatMap(r => r.claimChecks).filter(c => c.errors.length).length,
      critical_unsupported: graded.filter(r => r.judged!.verdict!.critical_unsupported).length,
      semantic_unsupported_claims: graded.reduce((sum, r) => sum + new Set(r.judged!.verdict!.unsupported_claim_ids).size, 0),
      trials_with_semantic_unsupported_claims: graded.filter(r => r.judged!.verdict!.unsupported_claim_ids.length).length,
      judged_trials: graded.length,
      attempted_p50_ms: quantile(attempted.map(r => r.trial.elapsed_ms), 0.5),
      attempted_p95_ms: quantile(attempted.map(r => r.trial.elapsed_ms), 0.95),
      stop_reasons: Object.fromEntries([...new Set(selected.map(r => r.trial.stop_reason))].map(reason => [reason, selected.filter(r => r.trial.stop_reason === reason).length])),
      planned: selected.length, assessed: scored, succeeded: success, success_rate: selected.length ? success / selected.length : null, coverage: selected.length ? scored / selected.length : 0, known_cost_usd: cost, cost_complete: !unknownCost, cost_per_success: success && !unknownCost ? cost / success : null, p50_ms: quantile(selected.filter(r => r.success).map(r => r.trial.elapsed_ms), 0.5), p95_ms: quantile(selected.filter(r => r.success).map(r => r.trial.elapsed_ms), 0.95), failures: selected.filter(r => r.success !== true).map(r => ({ id: r.trial.id, reasons: r.reasons, claim_errors: r.claimChecks.filter(c => c.errors.length) })) };
  };
  const modes = Object.fromEntries(m.modes.map(mode => [mode, summarize(rows.filter(r => r.trial.mode === mode))]));
  const slices = Object.fromEntries([...new Set(rows.map(r => r.category))].map(category => [category, Object.fromEntries(m.modes.map(mode => [mode, summarize(rows.filter(r => r.category === category && r.trial.mode === mode))]))]));
  const baseline: Mode = m.modes.includes("workflow") ? "workflow" : m.modes[0];
  const comparison = m.modes.includes("agentic") && baseline !== "agentic" ? (() => {
    const pairs: { family: string; a: number; b: number }[] = [];
    for (const a of rows.filter(r => r.trial.mode === baseline)) {
      const b = rows.find(r => r.trial.mode === "agentic" && r.trial.case_id === a.trial.case_id && r.trial.language === a.trial.language && r.trial.repeat === a.trial.repeat);
      if (b && a.success !== null && b.success !== null) pairs.push({ family: a.trial.family, a: Number(a.success), b: Number(b.success) });
    }
    return { baseline, candidate: "agentic", paired_trials: pairs.length, ...pairedClusterInterval(pairs, m.seed) };
  })() : null;
  const draft = cases.some(c => c.gold.review_status !== "gold");
  const datasetSplits = Object.fromEntries((["dev", "validation", "test"] as const).map(split => [split, cases.filter(c => c.split === split).length]));
  const testOnly = cases.length > 0 && cases.every(c => c.split === "test");
  const calibration = m.calibration;
  const calibrated = Boolean(calibration && calibration.execution === "live" && calibration.reviewed && calibration.n >= 30 && calibration.judge_model === m.judge_model && calibration.prompt_hash === m.rubric_hash && (calibration.precision ?? 0) >= 0.85 && (calibration.recall ?? 0) >= 0.9);
  const complete = rows.every(r => r.success !== null);
  const unsafe = rows.some(r => r.reasons.includes("prohibited_action") || r.reasons.includes("critical_unsupported"));
  let gate: "passed" | "regression" | "incomplete" | "inconclusive" = !complete ? "incomplete" : unsafe ? "regression" : "inconclusive";
  const baseCost = modes[baseline]?.cost_per_success;
  const agentCost = modes.agentic?.cost_per_success;
  const costRatio = baseCost && agentCost !== null && agentCost !== undefined ? agentCost / baseCost : null;
  const meetsAbsoluteQuality = (modes.agentic?.success_rate ?? 0) >= (m.protocol.min_success_rate ?? 0.8);
  if (complete && accounting?.complete !== false && !unsafe && !draft && calibrated && m.model !== "mock" && comparison && comparison.families >= m.protocol.min_families && comparison.lower !== null && costRatio !== null) {
    if (meetsAbsoluteQuality && comparison.lower >= -m.protocol.noninferiority_margin && costRatio <= m.protocol.max_cost_ratio && testOnly && m.engine_version === "shared-investigator-v1") gate = "passed";
    else if (!meetsAbsoluteQuality || comparison.upper! < -m.protocol.noninferiority_margin || costRatio > m.protocol.max_cost_ratio) gate = "regression";
  }
  const gateReasons: string[] = [];
  if (m.engine_version !== "shared-investigator-v1") gateReasons.push("legacy_experimental_engine");
  if (accounting?.complete === false) gateReasons.push("unresolved_call_costs");
  if (!complete) gateReasons.push("incomplete_trial_or_judgment_coverage");
  if (unsafe) gateReasons.push("critical_safety_or_grounding_failure");
  if (complete && !meetsAbsoluteQuality) gateReasons.push("candidate_below_absolute_success_floor");
  if (draft) gateReasons.push("unreviewed_dataset_labels");
  if (!testOnly) gateReasons.push("non_test_dataset");
  if (!calibrated) gateReasons.push("judge_calibration_missing_or_incompatible");
  if (m.model === "mock") gateReasons.push("mock_execution");
  if (!comparison || comparison.families < m.protocol.min_families) gateReasons.push("insufficient_independent_families");
  if (costRatio === null) gateReasons.push("cost_comparison_unavailable");
  else if (costRatio > m.protocol.max_cost_ratio) gateReasons.push("candidate_cost_exceeds_limit");
  if (comparison?.lower !== null && comparison?.lower !== undefined && comparison.lower < -m.protocol.noninferiority_margin) gateReasons.push("noninferiority_not_established");
  return { run_id: m.id, engine_version: m.engine_version, dataset_splits: datasetSplits, accounting, gate, gate_reasons: gateReasons, draft_labels: draft, calibrated, modes, slices, comparison, cost_ratio: costRatio, judge_cost_usd: judgments.reduce((s, j) => s + j.calls.reduce((x, c) => x + (c.cost_usd ?? 0), 0), 0), judge_cost_complete: judgments.every(j => j.calls.every(c => c.cost_usd !== null)), note: "Draft labels cannot pass a release gate. Synthetic benchmark results do not establish production readiness. Success rate uses all planned trials; incomplete coverage is not evidence of regression. Intervals cluster by incident family." };
}

export function reportMarkdown(report: ReturnType<typeof buildReport>): string {
  return [`# Evaluation ${report.run_id}`, `\nGate: **${report.gate}**. Draft labels: ${report.draft_labels}.`, `\nInvestigation engine: ${report.engine_version}.`, `\n${report.note}`, `\nDataset cases by split: dev=${report.dataset_splits.dev}, validation=${report.dataset_splits.validation}, test=${report.dataset_splits.test}. Only test-only runs can pass the release gate; split labels do not establish an unseen holdout.`, `\nGate reasons: ${report.gate_reasons.join(", ") || "all checks passed"}.`, ...(report.accounting ? [`\nRun accounting: $${report.accounting.accounted_cost_usd.toFixed(6)} (known usage plus unresolved reservations). ${report.accounting.scope}`] : []), "\n| Mode | Planned | Assessed | Success | Cost/success |", "|---|---:|---:|---:|---:|", ...Object.entries(report.modes).map(([mode, s]) => `| ${mode} | ${s.planned} | ${s.assessed} | ${s.succeeded} | ${s.cost_per_success === null ? "unknown / no successes" : s.cost_per_success.toFixed(5)} |`), `\nComparison (paired family bootstrap):\n\n\`\`\`json\n${JSON.stringify(report.comparison, null, 2)}\n\`\`\``, "\nDetailed slices, costs, and failures: report.json.\n"].join("\n");
}
