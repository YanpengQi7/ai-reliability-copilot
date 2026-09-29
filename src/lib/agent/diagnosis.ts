import { z } from "zod";
import { ClaimSchema } from "./evidence";

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
export const DecisionSchema = z.object({
  hypotheses: z.array(z.object({ hypothesis: z.string(), supporting_ids: z.array(z.string()), refuting_ids: z.array(z.string()), missing: z.string() })).max(5),
  done: z.boolean(),
  tool: z.enum(["get_metrics", "get_logs", "get_deploy_history", "search_runbooks"]),
  query: z.string().describe("Simple literal substring, not a query language. Empty string retrieves all available records for the service. Do not add service:, metric:, level: or time filters."),
  reason: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;
