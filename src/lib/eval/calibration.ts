import { z } from "zod";
import { evidenceItem, type Claim } from "../agent/evidence";
import { hash } from "./artifacts";
import type { EvalCase, Trial, Judgment } from "./contracts";
import { EVAL_JUDGE_PROMPT } from "./engine";

export type CalibrationSample = { id: string; trial: Trial; case: EvalCase; expected_unsupported: boolean };
export const ReviewsSchema = z.array(z.object({ sample_id: z.string(), reviewer: z.string().min(1), unsupported: z.boolean(), notes: z.string() }));
export type HumanReview = z.infer<typeof ReviewsSchema>[number];

/** Frozen factual mutations; human approval is still required before release gating. */
export function calibrationPack(): CalibrationSample[] {
  const pack: CalibrationSample[] = [];
  const at = "2026-09-01T10:00:00.000Z";
  for (let i = 0; i < 6; i++) {
    const value = 96.8 - i, service = `service-${i}`;
    const evidence = evidenceItem({ id: "e1", kind: "metric", source: "calibration fixture", service, observed_at: at, available_at: at, text: `${service} request success rate is ${value}% over 5m.`, measurement: { metric: "success_rate", value, unit: "%", window: "5m" } });
    for (const variant of ["observed", "wrong-service", "wrong-unit", "wrong-window", "derived"] as const) {
      const id = `calibration-${i}-${variant}`;
      const claim: Claim = variant === "derived" ? { id: "c1", kind: "derived", text: `${service} failure rate is ${(100 - value).toFixed(1)}% over 5m, calculated as 100% minus the observed success rate.`, evidence_ids: ["e1"], derivation: { operation: "complement_percent", operands: ["e1"], value: Math.round((100 - value) * 10) / 10, unit: "%" } } : { id: "c1", kind: "observed", text: `${variant === "wrong-service" ? "other-service" : service} request success rate is ${value}${variant === "wrong-unit" ? "ms" : "%"} over ${variant === "wrong-window" ? "24h" : "5m"}.`, evidence_ids: ["e1"], measurement: { service: variant === "wrong-service" ? "other-service" : service, metric: "success_rate", value, unit: variant === "wrong-unit" ? "ms" : "%", window: variant === "wrong-window" ? "24h" : "5m" } };
      const c: EvalCase = { id, family: `calibration-${i}`, category: "grounding-calibration", split: "dev", provenance: "synthetic", alert: { service, symptoms: "Assess the reported observation; root cause is unknown.", at }, evidence: [evidence], gold: { acceptable_severities: [], root_cause: "Insufficient causal evidence", required_evidence_ids: ["e1"], forbidden_actions: [], label_rationale: "This pack checks factual claims, not inferred causes.", policy_version: "impact-v2", sufficient: false, review_status: "draft", reviewers: [] } };
      const trial: Trial = { id, case_id: id, family: c.family, mode: "full", language: "en", repeat: 0, status: "succeeded", input: c.alert, evidence: [evidence], diagnosis: { summary: claim.text, conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "Duration and impact classification require confirmation.", root_causes: [], claims: [claim], mitigation_plan: [], missing_information: ["Causal evidence"] }, trace: [], calls: [], elapsed_ms: 0, failure: null, stop_reason: "fixed-calibration-answer" };
      pack.push({ id, trial, case: c, expected_unsupported: variant.startsWith("wrong-") });
    }
  }
  return pack;
}

export function wilson(successes: number, n: number) {
  if (!n) return { lower: null, upper: null };
  const z2 = 1.96 ** 2, p = successes / n, denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const spread = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return { lower: center - spread, upper: center + spread };
}

export function summarizeCalibration(pack: CalibrationSample[], judgments: Judgment[], reviews: HumanReview[], judgeModel: string, execution: "mock" | "live") {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let reviewed = true;
  for (const sample of pack) {
    const labels = reviews.filter(r => r.sample_id === sample.id);
    const uniqueReviewers = new Set(labels.map(r => r.reviewer.trim().toLowerCase()).filter(Boolean));
    const agreed = labels.length >= 2 && labels.length === uniqueReviewers.size && labels.every(r => r.unsupported === labels[0].unsupported);
    reviewed &&= agreed;
    const expected = agreed ? labels[0].unsupported : sample.expected_unsupported;
    const j = judgments.find(j => j.trial_id === sample.id && j.status === "succeeded" && j.trial_hash === hash(sample.trial) && j.prompt_hash === hash(EVAL_JUDGE_PROMPT) && j.judge_model === judgeModel);
    if (!j?.verdict) continue;
    const predicted = j.verdict.unsupported_claim_ids.includes("c1");
    if (predicted && expected) tp++; else if (predicted) fp++; else if (expected) fn++; else tn++;
  }
  const n = tp + fp + fn + tn;
  return { judge_model: judgeModel, prompt_hash: hash(EVAL_JUDGE_PROMPT), pack_hash: hash(pack), labels_hash: hash(reviews), n, planned: pack.length, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, precision_interval: wilson(tp, tp + fp), recall_interval: wilson(tp, tp + fn), confusion: { tp, fp, fn, tn }, reviewed: reviewed && n === pack.length, execution, note: "Intervals are descriptive binomial intervals; mutations share six source cases. Without two agreeing independent human labels per item these are draft calibration results." };
}
