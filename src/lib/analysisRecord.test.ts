import { describe, expect, it } from "vitest";
import type { Analysis } from "./schema";
import { buildAnalysisRecord } from "./analysisRecord";

const analysis: Analysis = {
  summary: "Checkout latency is elevated.",
  severity: "SEV2",
  severity_reasoning: "A subset of customers cannot complete checkout.",
  root_causes: [
    { hypothesis: "Database saturation", evidence: "Pool utilization is high", likelihood: "high" },
    { hypothesis: "Downstream latency", evidence: "Provider p99 increased", likelihood: "medium" },
    { hypothesis: "Deploy regression", evidence: "Started after release", likelihood: "low" },
  ],
  investigation_checklist: [
    { step: "Check pool", command: "show pool", expected: "Pool is saturated" },
    { step: "Check provider", command: "show provider", expected: "Provider latency is high" },
    { step: "Check deploy", command: "show deploy", expected: "Errors align with release" },
  ],
  mitigation_plan: [
    { action: "Reduce load", risk: "May shed requests", rollback: "Restore limits" },
    { action: "Rollback", risk: "Removes fixes", rollback: "Redeploy" },
  ],
  customer_impact: "Some checkout attempts fail.",
  postmortem_draft: "# Summary",
  follow_ups: [
    { item: "Tune pool", owner_role: "service owner", priority: "P1" },
    { item: "Add alert", owner_role: "on-call SRE", priority: "P1" },
    { item: "Load test", owner_role: "platform team", priority: "P2" },
  ],
};

describe("buildAnalysisRecord", () => {
  it("maps the canonical analysis and usage metadata", () => {
    const record = buildAnalysisRecord({
      incidentId: "incident-1",
      analysis,
      model: "deepseek-chat",
      promptVersion: "v3",
      outputLanguage: "en",
      latencyMs: 321,
      usage: { tokens_in: 100, tokens_out: 50, cost_usd: 0.001 },
    });

    expect(record).toMatchObject({
      incident_id: "incident-1",
      model: "deepseek-chat",
      prompt_version: "v3",
      output_language: "en",
      summary: analysis.summary,
      severity_reasoning: analysis.severity_reasoning,
      root_causes: analysis.root_causes,
      latency_ms: 321,
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
    });
  });

  it("stores absent operational metrics as null", () => {
    const record = buildAnalysisRecord({
      incidentId: "incident-2",
      analysis,
      model: "external-client",
      promptVersion: "mcp",
      outputLanguage: "zh",
    });

    expect(record).toMatchObject({
      latency_ms: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
    });
  });
});
