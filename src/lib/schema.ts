import { z } from "zod";

// Zod schema for the 9-section structured analysis the LLM must produce.
// Used by `generateObject` / `streamObject` to force valid JSON.

export const SeverityEnum = z.enum(["SEV1", "SEV2", "SEV3"]);

export const RootCauseHypothesis = z.object({
  hypothesis: z.string().describe("One concrete hypothesis, e.g. 'DB connection pool exhausted by slow query X'"),
  evidence: z.string().describe("Concrete signal from logs/metrics that supports this"),
  likelihood: z.enum(["high", "medium", "low"]),
});

export const InvestigationStep = z.object({
  step: z.string().describe("What to check, in plain English"),
  command: z.string().describe("Concrete command or query to run (kubectl, grep, SQL, curl, etc.). NOT 'check logs'"),
  expected: z.string().describe("What output would confirm or rule out the hypothesis"),
});

export const MitigationAction = z.object({
  action: z.string(),
  risk: z.string().describe("What can go wrong; explicitly call out destructive operations"),
  rollback: z.string(),
});

export const FollowUp = z.object({
  item: z.string(),
  owner_role: z.string().describe("e.g. 'on-call SRE', 'service owner', 'platform team'"),
  priority: z.enum(["P0", "P1", "P2"]),
});

export const AnalysisSchema = z.object({
  summary: z.string().describe("2-3 sentence incident summary, written for an incident commander"),
  severity: SeverityEnum,
  severity_reasoning: z.string().describe("Why this severity (user impact + scope + reversibility)"),
  root_causes: z.array(RootCauseHypothesis).min(3).max(5),
  investigation_checklist: z.array(InvestigationStep).min(3).max(8),
  mitigation_plan: z.array(MitigationAction).min(2).max(6),
  customer_impact: z.string().describe("Externally-facing summary: who is affected, what they see, ETA if known"),
  postmortem_draft: z.string().describe("Markdown postmortem skeleton: Summary / Timeline / Impact / Root Cause / What went well / What went poorly / Action items"),
  follow_ups: z.array(FollowUp).min(3).max(8),
});

export type Analysis = z.infer<typeof AnalysisSchema>;
