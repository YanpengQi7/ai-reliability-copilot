import { describe, expect, it } from "vitest";
import {
  buildAnalysisJson, buildAnalysisMarkdown, compareAnalysisSections,
  getAnalysisSections, normalizeAnalysisContent, reportFilename,
  type AnalysisContent,
} from "./analysisReview";

const analysis: AnalysisContent = {
  id: "analysis-2",
  incident_id: "incident-1",
  model: "deepseek-chat",
  prompt_version: "v3",
  output_language: "en",
  created_at: "2026-09-30T15:00:00Z",
  summary: "Checkout latency increased after release.",
  severity: "SEV2",
  severity_reasoning: "Checkout fails for a subset of customers.",
  root_causes: [{ hypothesis: "Pool exhausted", likelihood: "high", evidence: "Pending connections rose to 80." }],
  investigation_checklist: [{ step: "Inspect the pool", command: "kubectl logs deploy/checkout", expected: "Connection acquisition timeouts." }],
  mitigation_plan: [{ action: "Roll back release", risk: "Recent fixes are removed.", rollback: "Redeploy the current release." }],
  customer_impact: "Some customers cannot check out.",
  postmortem_draft: "### Timeline\n- 15:00: release deployed",
  follow_ups: [{ item: "Load test pool limits", owner_role: "Service owner", priority: "P1" }],
  latency_ms: 1200,
  tokens_in: 200,
  tokens_out: 400,
  cost_usd: "0.002",
};

describe("normalizeAnalysisContent", () => {
  it("preserves useful incomplete legacy entries while discarding malformed values", () => {
    const normalized = normalizeAnalysisContent({
      summary: 17,
      severity: null,
      root_causes: [null, "root cause", {}, { hypothesis: "Pool exhausted", evidence: 33 }],
      investigation_checklist: [{ command: "show pool", expected: false }, false],
      mitigation_plan: [{ rollback: "Restore previous setting", unrelated: "private note" }],
      follow_ups: { item: "Wrong container type" },
      raw_context: "unknown field must not escape",
      tokens_in: NaN,
      tokens_out: Infinity,
      cost_usd: "not a number",
    });
    expect(normalized.summary).toBe("");
    expect(normalized.severity).toBe("");
    expect(normalized.root_causes).toEqual([{ hypothesis: "Pool exhausted", evidence: "", likelihood: "" }]);
    expect(normalized.investigation_checklist).toEqual([{ step: "", command: "show pool", expected: "" }]);
    expect(normalized.mitigation_plan).toEqual([{ action: "", risk: "", rollback: "Restore previous setting" }]);
    expect(normalized.follow_ups).toEqual([]);
    expect(normalized.tokens_in).toBeNull();
    expect(normalized.tokens_out).toBeNull();
    expect(normalized.cost_usd).toBeNull();
    expect(normalized).not.toHaveProperty("raw_context");
    expect(normalized.mitigation_plan[0]).not.toHaveProperty("unrelated");
  });

  it.each([null, undefined, false, "old record", [], 42])("handles absent or invalid rows: %s", input => {
    const sections = getAnalysisSections(input);
    expect(sections).toHaveLength(9);
    expect(sections.every(section => typeof section.value === "string" ? section.value === "" : section.value.length === 0)).toBe(true);
  });

  it("preserves available operational metadata including zero usage", () => {
    expect(normalizeAnalysisContent({ ...analysis, tokens_in: 0, cost_usd: "0" })).toMatchObject({
      id: "analysis-2", model: "deepseek-chat", latency_ms: 1200,
      tokens_in: 0, tokens_out: 400, cost_usd: 0,
    });
  });
});

describe("compareAnalysisSections", () => {
  it("compares the nine content sections independently of run metadata and object key order", () => {
    const sameContent = {
      ...analysis,
      id: "another-id", prompt_version: "v1", model: "different-model", output_language: "zh",
      created_at: "2020-01-01T00:00:00Z", latency_ms: 100, cost_usd: 3,
      root_causes: [{ evidence: "Pending connections rose to 80.", likelihood: "high", hypothesis: "Pool exhausted", unknown: "ignored" }],
    };
    expect(compareAnalysisSections(analysis, sameContent).every(section => !section.changed)).toBe(true);
    expect(compareAnalysisSections(analysis, analysis).every(section => !section.changed)).toBe(true);
  });

  it("identifies severity and nested command/rollback changes in their own sections", () => {
    const revised = {
      ...analysis,
      severity: "SEV1",
      investigation_checklist: [{ step: "Inspect the pool", command: "kubectl logs deploy/payments", expected: "Connection acquisition timeouts." }],
      mitigation_plan: [{ action: "Roll back release", risk: "Recent fixes are removed.", rollback: "Restore the traffic route." }],
    };
    const differences = compareAnalysisSections(analysis, revised);
    expect(differences.filter(section => section.changed).map(section => section.key)).toEqual([
      "severity", "investigation_checklist", "mitigation_plan",
    ]);
    expect(differences.find(section => section.key === "severity")).toMatchObject({ before: "SEV2", after: "SEV1" });
  });

  it("preserves ranked hypothesis and checklist order", () => {
    const first = { ...analysis, root_causes: [
      { hypothesis: "Pool exhausted", likelihood: "high", evidence: "Queues are full" },
      { hypothesis: "Provider outage", likelihood: "medium", evidence: "Provider latency rose" },
    ] };
    const reversed = { ...first, root_causes: [...first.root_causes].reverse() };
    expect(compareAnalysisSections(first, reversed).filter(section => section.changed).map(section => section.key)).toEqual(["root_causes"]);
  });

  it("treats empty/null legacy content consistently without mutating inputs", () => {
    const historical = Object.freeze({ summary: null, root_causes: null });
    expect(compareAnalysisSections(historical, { summary: "", root_causes: [] }).some(section => section.changed)).toBe(false);
    expect(historical).toEqual({ summary: null, root_causes: null });
  });
});

describe("analysis report exports", () => {
  const context = {
    id: "incident-1", title: "Checkout incident", service: "checkout", symptoms: "p99 latency 8s",
    raw_context: "private log token=secret-raw-only",
  };

  it("excludes the raw context field by default in both formats", () => {
    const markdown = buildAnalysisMarkdown({ ...analysis, raw_context: "unknown-secret" }, context);
    const json = buildAnalysisJson({ ...analysis, raw_context: "unknown-secret" }, context);
    expect(markdown).not.toContain(context.raw_context);
    expect(json).not.toContain(context.raw_context);
    expect(markdown).not.toContain("unknown-secret");
    expect(json).not.toContain("unknown-secret");
    expect(JSON.parse(json).incident).not.toHaveProperty("raw_context");
  });

  it("includes raw context only through the explicit export option", () => {
    expect(buildAnalysisMarkdown(analysis, context, { includeRawContext: true })).toContain(context.raw_context);
    expect(JSON.parse(buildAnalysisJson(analysis, context, { includeRawContext: true })).incident.raw_context).toBe(context.raw_context);
  });

  it("exports every analysis section with evidence, commands, risk and rollback", () => {
    const markdown = buildAnalysisMarkdown(analysis, context);
    for (const label of ["Summary", "Severity", "Severity reasoning", "Root cause hypotheses", "Investigation checklist", "Mitigation plan", "Customer impact", "Postmortem draft", "Follow-ups"]) {
      expect(markdown).toContain(`## ${label}\n`);
    }
    for (const expected of ["hypotheses to verify", "Pending connections rose to 80.", "kubectl logs deploy/checkout", "Risk: Recent fixes are removed.", "Rollback: Redeploy the current release.", "Service owner", "P1"]) {
      expect(markdown).toContain(expected);
    }
    const json = JSON.parse(buildAnalysisJson(analysis, context));
    expect(json.incident).toEqual({ id: "incident-1", title: "Checkout incident", service: "checkout", symptoms: "p99 latency 8s" });
    expect(json.analysis).toEqual(normalizeAnalysisContent(analysis));
  });

  it("keeps command and log fences intact when they contain backticks", () => {
    const command = "printf '``` and ````'\necho done";
    const markdown = buildAnalysisMarkdown({ ...analysis, investigation_checklist: [{ step: "Inspect", command }] }, {
      raw_context: "````` embedded log fence",
    }, { includeRawContext: true });
    expect(markdown).toContain(`\n\`\`\`\`\`\n${command}\n\`\`\`\`\`\n`);
    expect(markdown).toContain("\n``````text\n````` embedded log fence\n``````\n");
  });

  it("preserves run identity and measured usage in both formats", () => {
    const markdown = buildAnalysisMarkdown({ ...analysis, tokens_in: 0 }, context);
    expect(markdown).toContain("**Analysis ID:** analysis-2");
    expect(markdown).toContain("**Model:** deepseek-chat");
    expect(markdown).toContain("**Prompt version:** v3");
    expect(markdown).toContain("**Output language:** en");
    expect(markdown).toContain("**Analysis created:** 2026-09-30T15:00:00Z");
    expect(markdown).toContain("**Latency (ms):** 1200");
    expect(markdown).toContain("**Input tokens:** 0");
    expect(markdown).toContain("**Output tokens:** 400");
    expect(markdown).toContain("**Cost (USD):** 0.002");
    expect(JSON.parse(buildAnalysisJson(analysis)).incident.id).toBe("incident-1");
  });

  it("uses Chinese report labels while preserving the analysis output text", () => {
    const markdown = buildAnalysisMarkdown(analysis, context, { locale: "zh" });
    expect(markdown).toContain("## 严重等级\n");
    expect(markdown).toContain("## 根因假设\n");
    expect(markdown).toContain("风险： Recent fixes are removed.");
    expect(markdown).toContain("回滚： Redeploy the current release.");
    expect(markdown).toContain("Checkout latency increased after release.");
    expect(markdown).not.toContain("section.severity");
  });

  it("renders missing legacy fields as unrecorded without inventing evidence", () => {
    const markdown = buildAnalysisMarkdown({ root_causes: [{ hypothesis: "Pool exhausted" }] });
    expect(markdown).toContain("Evidence: Not recorded");
    expect(markdown).toContain("## Severity\n\nNot recorded");
    expect(markdown).not.toContain("undefined");
    expect(markdown).not.toContain("[object Object]");
  });
});

describe("reportFilename", () => {
  it("creates bounded portable names while preserving Chinese titles", () => {
    expect(reportFilename("  Checkout / pool: incident?  ", "md")).toBe("checkout-pool-incident.md");
    expect(reportFilename("支付服务连接池", "json")).toBe("支付服务连接池.json");
    expect(reportFilename("../../", "md")).toBe("incident-analysis.md");
    expect(reportFilename(null, "json")).toBe("incident-analysis.json");
    expect(reportFilename("CON", "md")).toBe("incident-con.md");
    expect(reportFilename("x".repeat(200), "md")).toHaveLength(83);
  });
});
