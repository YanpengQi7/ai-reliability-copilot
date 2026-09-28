import { z } from "zod";
import { EvidenceSchema, ClaimSchema } from "../agent/evidence";
import { RubricScores } from "./rubric";

export const ModeSchema = z.enum(["alert", "full", "workflow", "agentic"]);
export type Mode = z.infer<typeof ModeSchema>;
export const DiagnosisSchema = z.object({
  summary: z.string().min(1),
  conclusion_status: z.enum(["supported", "tentative", "insufficient_evidence"]),
  severity: z.enum(["SEV1", "SEV2", "SEV3"]).nullable(),
  severity_reasoning: z.string(),
  root_causes: z.array(z.object({ hypothesis: z.string(), supporting_ids: z.array(z.string()), refuting_ids: z.array(z.string()), missing_evidence: z.array(z.string()), next_check: z.string() })).max(5),
  claims: z.array(ClaimSchema).max(30).refine(claims => new Set(claims.map(c => c.id)).size === claims.length, "Duplicate claim IDs"),
  mitigation_plan: z.array(z.object({ action: z.string(), risk: z.string(), rollback: z.string() })).max(6),
  missing_information: z.array(z.string()),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export const GoldSchema = z.object({
  acceptable_severities: z.array(z.enum(["SEV1", "SEV2", "SEV3"])),
  root_cause: z.string(), required_evidence_ids: z.array(z.string()),
  forbidden_actions: z.array(z.string()), label_rationale: z.string().min(1),
  policy_version: z.literal("impact-v2"),
  sufficient: z.boolean(), review_status: z.enum(["draft", "single_review", "gold"]),
  reviewers: z.array(z.string()),
});
export const CaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), family: z.string(), category: z.string(),
  split: z.enum(["dev", "validation", "test"]), provenance: z.enum(["synthetic", "authorized_real"]),
  alert: z.object({ service: z.string(), symptoms: z.string(), at: z.string().datetime() }),
  evidence: z.array(EvidenceSchema), gold: GoldSchema,
});
export type EvalCase = z.infer<typeof CaseSchema>;
export const CalibrationSchema = z.object({
  judge_model: z.string(), prompt_hash: z.string(), pack_hash: z.string(), labels_hash: z.string(),
  n: z.number().int().nonnegative(), precision: z.number().min(0).max(1).nullable(), recall: z.number().min(0).max(1).nullable(),
  reviewed: z.boolean(), execution: z.enum(["mock", "live"]),
});
export const UsageSchema = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative(), cost_usd: z.number().nonnegative().nullable(), model: z.string(), purpose: z.enum(["generation", "judge"]), request_id: z.string().optional() });
export type CallUsage = z.infer<typeof UsageSchema>;
export const ManifestSchema = z.object({
  version: z.literal("eval-v2"), id: z.string().regex(/^[a-zA-Z0-9_-]+$/), created_at: z.string(),
  git_sha: z.string(), dirty: z.boolean(), source_hash: z.string(), dataset_hash: z.string(),
  prompt_hash: z.string(), schema_hash: z.string(), rubric_hash: z.string(), policy_version: z.literal("impact-v2"),
  thinking: z.enum(["disabled", "provider_default"]).default("provider_default"),
  model: z.string(), judge_model: z.string(), modes: z.array(ModeSchema).min(1), languages: z.array(z.enum(["en", "zh"])).min(1), repeats: z.number().int().min(1).max(20), seed: z.number().int(),
  budget: z.object({ max_usd: z.number().positive(), max_minutes: z.number().positive(), per_call_usd: z.number().positive(), max_calls: z.number().int().positive(), max_output_tokens: z.number().int().positive(), input_per_million: z.number().nonnegative(), output_per_million: z.number().nonnegative(), judge_input_per_million: z.number().nonnegative(), judge_output_per_million: z.number().nonnegative() }),
  calibration: CalibrationSchema.nullable().default(null),
  case_ids: z.array(z.string()).min(1), ablation: z.enum(["default", "no_kb", "no_state"]).default("default"),
  protocol: z.object({ min_families: z.number().int().min(2), noninferiority_margin: z.number().min(0).max(1), max_cost_ratio: z.number().positive() }),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export const TrialSchema = z.object({
  id: z.string(), case_id: z.string(), family: z.string(), mode: ModeSchema, language: z.enum(["en", "zh"]), repeat: z.number().int(),
  status: z.enum(["pending", "running", "succeeded", "failed", "budget_skipped", "interrupted"]),
  input: CaseSchema.shape.alert, evidence: z.array(EvidenceSchema), diagnosis: DiagnosisSchema.nullable(),
  trace: z.array(z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()), evidence_ids: z.array(z.string()), observation: z.string() })),
  calls: z.array(UsageSchema), elapsed_ms: z.number().nonnegative(), failure: z.string().nullable(), stop_reason: z.string(),
});
export type Trial = z.infer<typeof TrialSchema>;
export const VerdictSchema = z.object({
  core: RubricScores,
  root_cause_acceptable: z.boolean(), uncertainty_appropriate: z.boolean(), prohibited_action: z.boolean(),
  unsupported_claim_ids: z.array(z.string()), critical_unsupported: z.boolean(), reasoning: z.string(),
});
export const JudgmentSchema = z.object({
  trial_id: z.string(), judge_run_id: z.string(), trial_hash: z.string(), judge_model: z.string(), prompt_hash: z.string(),
  status: z.enum(["succeeded", "failed"]), verdict: VerdictSchema.nullable(), calls: z.array(UsageSchema), failure: z.string().nullable(),
});
export type Judgment = z.infer<typeof JudgmentSchema>;
