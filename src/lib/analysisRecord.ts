import type { Analysis } from "./schema";

type AnalysisUsage = {
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | null;
};

export type AnalysisRecordInput = {
  incidentId: string;
  analysis: Analysis;
  model: string;
  promptVersion: string;
  outputLanguage: "en" | "zh";
  latencyMs?: number | null;
  usage?: AnalysisUsage;
};

/** Keep every successful analysis write aligned with the canonical schema. */
export function buildAnalysisRecord(input: AnalysisRecordInput) {
  const { analysis } = input;
  return {
    incident_id: input.incidentId,
    model: input.model,
    prompt_version: input.promptVersion,
    output_language: input.outputLanguage,
    summary: analysis.summary,
    severity: analysis.severity,
    severity_reasoning: analysis.severity_reasoning,
    root_causes: analysis.root_causes,
    investigation_checklist: analysis.investigation_checklist,
    mitigation_plan: analysis.mitigation_plan,
    customer_impact: analysis.customer_impact,
    postmortem_draft: analysis.postmortem_draft,
    follow_ups: analysis.follow_ups,
    latency_ms: input.latencyMs ?? null,
    tokens_in: input.usage?.tokens_in ?? null,
    tokens_out: input.usage?.tokens_out ?? null,
    cost_usd: input.usage?.cost_usd ?? null,
  };
}
