import { describe, expect, it } from "vitest";
import { buildInvestigationJson, buildInvestigationMarkdown } from "./investigationReport";

const metric = {
  id: "e1", kind: "metric", source: "Metrics adapter", service: "checkout",
  observed_at: "2026-10-05T12:00:00Z", available_at: "2026-10-05T12:00:01Z",
  text: "RAW_EVIDENCE_TEXT_ONLY", content_hash: "original-source-hash-1",
  measurement: { metric: "error_rate", value: 12, unit: "%", window: "5m" },
};
const log = {
  ...metric, id: "e2", kind: "log", source: "Log adapter", text: "RAW_LOG_TEXT_ONLY", content_hash: "original-source-hash-2", measurement: undefined,
};
const result = {
  engine_version: "shared-investigation-v2", language: "en", completed: false, stop_reason: "budget_cap", steps: 4,
  usage: { model_calls: 3, tokens_in: 500, tokens_out: 250, cost_usd: 0.002 },
  diagnosis: {
    summary: "Cause remains uncertain.", conclusion_status: "insufficient_evidence", severity: null,
    severity_reasoning: "Customer impact measurements are missing.",
    root_causes: [{ hypothesis: "Pool saturation", supporting_ids: ["e1"], refuting_ids: ["e2"], missing_evidence: ["Connection limit"], next_check: "Read max_connections" }],
    claims: [
      { id: "c1", kind: "observed", text: "Error rate is 12%.", evidence_ids: ["e1"], measurement: { service: "checkout", metric: "error_rate", value: 12, unit: "%", window: "5m" } },
      { id: "c2", kind: "derived", text: "Success rate is 88%.", evidence_ids: ["e1"], derivation: { operation: "complement_percent", operands: ["e1"], value: 88, unit: "%" } },
    ],
    mitigation_plan: [{ action: "Limit worker traffic", risk: "Some requests may be rejected", rollback: "Restore the previous worker limit" }],
    missing_information: ["Customer impact measurements"],
  },
  analysis: {
    summary: "Investigation incomplete; unresolved checks remain.", severity: null, severity_reasoning: "Impact is not established.",
    root_causes: [{ hypothesis: "Pool saturation", evidence: "Supports e1; contradicts e2", likelihood: "unassessed" }],
    investigation_checklist: [{ step: "Read connection limit", command: "show max_connections;", expected: "Confirm or refute saturation" }],
    mitigation_plan: [{ action: "Limit worker traffic", risk: "Some requests may be rejected", rollback: "Restore the previous worker limit" }],
    customer_impact: "Impact is unknown.", postmortem_draft: "### Timeline\nCollect missing measurements.",
    follow_ups: [{ item: "Collect impact metrics", owner_role: "On-call engineer", priority: "P1" }],
  },
  decisions: [
    { done: false, tool: "get_metrics", query: "RAW_PLANNER_QUERY_ONLY", reason: "Read telemetry before diagnosing.", hypotheses: [{ hypothesis: "Pool saturation", supporting_ids: ["e1"], refuting_ids: ["e2"], missing: "Connection limit" }] },
    { done: true, tool: "get_logs", query: "", reason: "No further checks within budget.", hypotheses: [] },
  ],
  trace: [
    { index: 1, tool: "get_metrics", status: "ok", reason: "", latency_ms: 12, evidence: [metric], observation: "RAW_OBSERVATION_ONLY", input: { service: "checkout", filter: "RAW_INPUT_FILTER_ONLY", query: "RAW_INPUT_QUERY_ONLY", limit: 12, private_extra: "UNKNOWN_INPUT_ONLY" } },
    { index: 2, tool: "execute_rollback", status: "refused", reason: "read_only", latency_ms: 0, observation: "RAW_REFUSAL_ONLY", input: { service: "checkout", to_version: "1.2" } },
    { index: 3, tool: "get_logs", status: "error", reason: "adapter_failure", latency_ms: 23, observation: "RAW_ERROR_ONLY", input: {} },
    { index: 4, tool: "search_runbooks", status: "empty", reason: "no_matches", latency_ms: 4, observation: "RAW_EMPTY_ONLY", input: {} },
  ],
  evidence: [metric, log],
};
const context = { scenario_slug: "checkout-sample", requested_language: "zh" as const, generated_at: "2026-10-05T12:01:00Z" };

describe("dedicated investigation report", () => {
  it("preserves incomplete state, unknown severity and true diagnosis status prominently", () => {
    const json = JSON.parse(buildInvestigationJson(result, context));
    expect(json.result.completed).toBe(false);
    expect(json.result.stop_reason).toBe("budget_cap");
    expect(json.result.diagnosis.conclusion_status).toBe("insufficient_evidence");
    expect(json.result.diagnosis.severity).toBeNull();
    expect(json.result.analysis.severity).toBeNull();
    expect(json.result.analysis.root_causes[0].likelihood).toBe("unassessed");
    expect(json.context).toEqual(context);
    expect(json.result.language).toBe("en");
    const markdown = buildInvestigationMarkdown(result, context);
    expect(markdown).toContain("**Run completion:** Investigation incomplete");
    expect(markdown).toContain("**Stop reason:** budget_cap");
    expect(markdown).toContain("**Diagnosis status:** Insufficient evidence");
    expect(markdown).toContain("**Severity:** Unknown severity");
    expect(markdown).not.toContain("SEV3");
  });

  it("exports a sanitized custom incident identity without exporting its raw context", () => {
    const reportContext = { scenario_slug: "custom", title: "Checkout latency", service: "checkout", requested_language: "en" as const, max_steps_requested: 12 };
    const jsonText = buildInvestigationJson(result, reportContext);
    const json = JSON.parse(jsonText);
    expect(json.context).toMatchObject({ scenario_slug: "custom", title: "Checkout latency", service: "checkout", max_steps_requested: 12 });
    expect(jsonText).not.toContain("RAW_EVIDENCE_TEXT_ONLY");
    const markdown = buildInvestigationMarkdown(result, reportContext);
    expect(markdown).toContain("**Incident title:** Checkout latency");
    expect(markdown).toContain("**Service:** checkout");
    expect(markdown).toContain("**Requested maximum investigation steps:** 12");
  });

  it("exports all presentation sections and diagnosis evidence/refutations without filling invented content", () => {
    const json = JSON.parse(buildInvestigationJson(result)).result;
    expect(json.analysis).toEqual(result.analysis);
    expect(json.diagnosis.root_causes).toEqual(result.diagnosis.root_causes);
    expect(json.diagnosis.missing_information).toEqual(result.diagnosis.missing_information);
    expect(json.diagnosis.claims[0].measurement).toEqual(result.diagnosis.claims[0].measurement);
    expect(json.diagnosis.claims[1].derivation).toEqual(result.diagnosis.claims[1].derivation);
    const markdown = buildInvestigationMarkdown(result);
    expect(markdown).toContain("**Contradicting evidence IDs:** e2");
    expect(markdown).toContain("**Missing evidence:** Connection limit");
    expect(markdown).toContain("**Next discriminating check:** Read max_connections");
    expect(markdown).toContain("**Operand evidence IDs:** e1");
    expect(markdown).toContain("**Operation:** complement_percent");
    expect(markdown).toContain("**Value:** 88");
    expect(markdown).toContain("**Risk:** Some requests may be rejected");
    expect(markdown).toContain("**Rollback:** Restore the previous worker limit");
    expect(markdown).toContain("show max_connections;");
    expect(markdown).toContain("### Customer impact");
    expect(markdown).toContain("### Postmortem draft");
    expect(markdown).toContain("**Suggested owner role:** On-call engineer");
  });

  it("retains every tool outcome and planner decision, including errors/refusals/empty results", () => {
    const json = JSON.parse(buildInvestigationJson(result)).result;
    expect(json.trace.map((step: { status: string }) => step.status)).toEqual(["ok", "refused", "error", "empty"]);
    expect(json.trace[0].evidence_ids).toEqual(["e1"]);
    expect(json.trace[1]).toMatchObject({ tool: "execute_rollback", reason: "read_only", latency_ms: 0 });
    expect(json.decisions[0].hypotheses[0].refuting_ids).toEqual(["e2"]);
    expect(json.decisions[1].done).toBe(true);
    expect(json.usage).toEqual(result.usage);
    expect(json.engine_version).toBe(result.engine_version);
    const markdown = buildInvestigationMarkdown(result);
    for (const status of ["ok", "refused", "error", "empty"]) expect(markdown).toContain(`**Read status:** ${status}`);
  });

  it("labels mixed supporting/refuting presentation prose as an evidence summary", () => {
    const english = buildInvestigationMarkdown(result);
    expect(english).toContain("**Evidence summary:** Supports e1; contradicts e2");
    expect(english).not.toContain("**Supporting evidence IDs:** Supports e1; contradicts e2");
    expect(english).toContain("**Supporting evidence IDs:** e1");
    expect(english).toContain("**Contradicting evidence IDs:** e2");
    expect(buildInvestigationMarkdown(result, {}, { locale: "zh" })).toContain("**证据摘要:** Supports e1; contradicts e2");
  });

  it("omits raw fields by default while preserving measurements and source metadata", () => {
    const text = buildInvestigationJson(result, context);
    const json = JSON.parse(text);
    for (const marker of ["RAW_EVIDENCE_TEXT_ONLY", "RAW_LOG_TEXT_ONLY", "RAW_OBSERVATION_ONLY", "RAW_PLANNER_QUERY_ONLY", "RAW_INPUT_FILTER_ONLY", "RAW_INPUT_QUERY_ONLY", "UNKNOWN_INPUT_ONLY"]) {
      expect(text).not.toContain(marker);
      expect(buildInvestigationMarkdown(result)).not.toContain(marker);
    }
    expect(json.result.evidence[0]).toMatchObject({ id: "e1", source: "Metrics adapter", observed_at: metric.observed_at, measurement: metric.measurement, source_content_hash: metric.content_hash });
    expect(json.result.evidence[0]).not.toHaveProperty("text");
    expect(json.result.trace[0]).not.toHaveProperty("input");
    expect(json.result.trace[0]).not.toHaveProperty("observation");
    expect(json.result.decisions[0]).not.toHaveProperty("query");
    expect(json.privacy.raw_evidence_included).toBe(false);
  });

  it("includes whitelisted raw text and inputs only after explicit opt-in", () => {
    const json = JSON.parse(buildInvestigationJson(result, context, { includeRawEvidence: true }));
    expect(json.result.evidence[0].text).toBe(metric.text);
    expect(json.result.trace[0].observation).toBe("RAW_OBSERVATION_ONLY");
    expect(json.result.trace[0].input).toEqual({ service: "checkout", query: "RAW_INPUT_QUERY_ONLY", filter: "RAW_INPUT_FILTER_ONLY", limit: 12 });
    expect(json.result.trace[1].input.to_version).toBe("1.2");
    expect(json.result.decisions[0].query).toBe("RAW_PLANNER_QUERY_ONLY");
    expect(JSON.stringify(json)).not.toContain("UNKNOWN_INPUT_ONLY");
    expect(json.privacy.raw_evidence_included).toBe(true);
  });

  it("also omits synthesized tool input embedded in legacy provenance unless raw export is enabled", () => {
    const token = "sk-" + "a".repeat(30);
    const toolSource = `get_logs(${JSON.stringify({ service: "checkout", query: `PRIVATE_QUERY_TOKEN ${token}`, limit: 12 })})`;
    const legacy = { evidence: [{ ...log, kind: "tool_observation", source: toolSource }] };
    for (const report of [buildInvestigationJson(legacy), buildInvestigationMarkdown(legacy)]) {
      expect(report).not.toContain("PRIVATE_QUERY_TOKEN");
      expect(report).not.toContain(token);
    }
    expect(JSON.parse(buildInvestigationJson(legacy)).result.evidence[0].source).toBe("get_logs");
    const raw = JSON.parse(buildInvestigationJson(legacy, {}, { includeRawEvidence: true }));
    expect(raw.result.evidence[0].source).toContain("PRIVATE_QUERY_TOKEN");
    expect(raw.result.evidence[0].source).toContain("[REDACTED: OpenAI API key]");
    expect(raw.result.evidence[0].source_content_hash).toBe(log.content_hash);
    expect(legacy.evidence[0].source).toBe(toolSource);
    for (const source of ["runbooks/checkouts.md", "get_logs(not-json)", "get_logs([1,2])"]) {
      expect(JSON.parse(buildInvestigationJson({ evidence: [{ ...log, kind: "tool_observation", source }] })).result.evidence[0].source).toBe(source);
    }
  });

  it("retains trace-only legacy evidence and audits it against claims", () => {
    const legacy = { diagnosis: { claims: [{ id: "c1", kind: "observed", text: "Error rate is 12%", evidence_ids: ["e1"] }] }, trace: [{ ...result.trace[0], evidence: [metric] }] };
    const json = JSON.parse(buildInvestigationJson(legacy));
    expect(json.result.evidence).toHaveLength(1);
    expect(json.result.evidence[0].id).toBe("e1");
    expect(json.reference_audit.missing_ids).toEqual([]);
  });

  it("reports missing and ambiguous references without claiming semantic verification", () => {
    const conflicting = { ...metric, text: "A different observation", content_hash: "other-original-hash" };
    const disputed = {
      ...result, evidence: [metric, conflicting, log],
      diagnosis: { ...result.diagnosis, claims: [{ id: "c3", kind: "derived", text: "Unverified arithmetic", evidence_ids: ["missing-claim"], derivation: { operation: "difference", operands: ["missing-operand", "e1"], value: 2, unit: "%" } }] },
    };
    const json = JSON.parse(buildInvestigationJson(disputed));
    expect(json.result.evidence).toHaveLength(3);
    expect(json.reference_audit.missing_ids).toEqual(["missing-claim", "missing-operand"]);
    expect(json.reference_audit.ambiguous_ids).toEqual(["e1"]);
    expect(json.reference_audit.semantic_review_required).toBe(true);
    expect(json.reference_audit.note).toContain("does not verify factual support or arithmetic");
    const markdown = buildInvestigationMarkdown(disputed);
    expect(markdown).toContain("**Missing evidence IDs:** missing-claim, missing-operand");
    expect(markdown).toContain("**Ambiguous evidence IDs:** e1");
  });

  it("labels hashes as original source provenance without pretending transformed text can verify them", () => {
    for (const includeRawEvidence of [false, true]) {
      const json = JSON.parse(buildInvestigationJson(result, {}, { includeRawEvidence }));
      expect(json.result.evidence[0].source_content_hash).toBe(metric.content_hash);
      expect(json.result.evidence[0]).not.toHaveProperty("content_hash");
      expect(json.privacy.source_hash_note).toContain("cannot be verified against those original hashes");
      const markdown = buildInvestigationMarkdown(result, {}, { includeRawEvidence });
      expect(markdown).toContain("**Original source content hash:** original-source-hash-1");
    }
  });

  it("redacts supported credentials across source narratives, measurements, context and opted-in raw fields", () => {
    const token = "sk-" + "a".repeat(30);
    const privateBody = "PRIVATE_KEY_BODY_MUST_NOT_EXPORT";
    const sensitive = {
      ...result,
      analysis: { ...result.analysis, summary: token, mitigation_plan: [{ action: token, risk: token, rollback: token }] },
      diagnosis: { ...result.diagnosis, summary: token, claims: [{ id: "c1", kind: "observed", text: token, evidence_ids: ["e1"], measurement: { service: token, metric: token, value: 0, unit: token, window: token } }] },
      decisions: [{ ...result.decisions[0], query: token, reason: token }],
      trace: [{ ...result.trace[0], observation: `-----BEGIN RSA PRIVATE KEY-----\n${privateBody}\n-----END RSA PRIVATE KEY-----`, input: { service: token, query: token } }],
      evidence: [{ ...metric, source: token, service: token, text: token }],
    };
    for (const report of [buildInvestigationJson(sensitive, { scenario_slug: token }, { includeRawEvidence: true }), buildInvestigationMarkdown(sensitive, { scenario_slug: token }, { includeRawEvidence: true })]) {
      expect(report).not.toContain(token);
      expect(report).not.toContain(privateBody);
      expect(report).toContain("[REDACTED: OpenAI API key]");
      expect(report).toContain("[REDACTED: Private key (PEM)]");
    }
    expect(sensitive.analysis.summary).toBe(token);
    expect(sensitive.trace[0].observation).toContain(privateBody);
  });

  it("drops unknown attributes at every nesting level, including under raw opt-in", () => {
    const forbidden = "UNKNOWN_RAW_CONTEXT_MUST_NEVER_EXPORT";
    const unexpected = {
      ...result, raw_context: forbidden,
      analysis: { ...result.analysis, raw_context: forbidden, follow_ups: [{ ...result.analysis.follow_ups[0], raw_context: forbidden }] },
      diagnosis: { ...result.diagnosis, raw_context: forbidden, root_causes: [{ ...result.diagnosis.root_causes[0], raw_context: forbidden }], claims: [{ ...result.diagnosis.claims[0], raw_context: forbidden, measurement: { ...result.diagnosis.claims[0].measurement, raw_context: forbidden }, derivation: { operation: "difference", operands: ["e1"], value: 0, unit: "%", raw_context: forbidden } }] },
      decisions: [{ ...result.decisions[0], raw_context: forbidden, hypotheses: [{ ...result.decisions[0].hypotheses[0], raw_context: forbidden }] }],
      trace: [{ ...result.trace[0], raw_context: forbidden, input: { raw_context: forbidden, context: { nested: forbidden } } }],
      evidence: [{ ...metric, raw_context: forbidden, measurement: { ...metric.measurement, raw_context: forbidden } }],
    };
    expect(buildInvestigationJson(unexpected, { ...context, raw_context: forbidden } as typeof context, { includeRawEvidence: true })).not.toContain(forbidden);
    expect(buildInvestigationMarkdown(unexpected, {}, { includeRawEvidence: true })).not.toContain(forbidden);
  });

  it("normalizes malformed enums to null rather than claiming completion, success, or severity", () => {
    const malformed = {
      completed: "true", stop_reason: "finished", language: "fr", steps: Infinity,
      usage: { model_calls: -1, tokens_in: NaN, tokens_out: "100", cost_usd: Infinity },
      analysis: { severity: "SEV0", root_causes: [{ likelihood: "high" }], follow_ups: [{ priority: "critical" }] },
      diagnosis: { severity: "SEV5", conclusion_status: "proven", claims: [{ kind: "fact", measurement: { value: NaN }, derivation: { operation: "sum", operands: ["e1"], value: Infinity } }] },
      decisions: [{ done: "yes", tool: "execute_rollback" }], trace: [{ index: -1, status: "success", latency_ms: Infinity }],
    };
    const json = JSON.parse(buildInvestigationJson(malformed)).result;
    expect(json.completed).toBeNull();
    expect(json.stop_reason).toBeNull();
    expect(json.language).toBeNull();
    expect(json.steps).toBeNull();
    expect(json.usage).toEqual({ model_calls: null, tokens_in: null, tokens_out: null, cost_usd: null });
    expect(json.analysis.severity).toBeNull();
    expect(json.analysis.root_causes[0].likelihood).toBeNull();
    expect(json.analysis.follow_ups[0].priority).toBeNull();
    expect(json.diagnosis.conclusion_status).toBeNull();
    expect(json.diagnosis.claims[0].kind).toBeNull();
    expect(json.diagnosis.claims[0].measurement).toBeNull();
    expect(json.diagnosis.claims[0].derivation.operation).toBeNull();
    expect(json.decisions[0]).toMatchObject({ done: null, tool: null });
    expect(json.trace[0].status).toBeNull();
    const markdown = buildInvestigationMarkdown(malformed);
    expect(markdown).toContain("**Run completion:** Completion not recorded");
    expect(markdown).toContain("**Diagnosis status:** Not recorded");
    expect(markdown).not.toContain("Run completed");
  });

  it.each([null, undefined, [], "legacy", { analysis: null, diagnosis: null, trace: [null, 7], decisions: false }])("supports minimal and malformed legacy results: %s", source => {
    const json = JSON.parse(buildInvestigationJson(source));
    expect(json.result.completed).toBeNull();
    expect(json.result.diagnosis.severity).toBeNull();
    expect(json.result.evidence).toEqual([]);
    const markdown = buildInvestigationMarkdown(source);
    expect(markdown).not.toContain("undefined");
    expect(markdown).not.toContain("[object Object]");
    expect(markdown).toContain("Unknown severity");
  });

  it("ignores inherited source fields and does not mutate a frozen source snapshot", () => {
    const inherited = Object.create({ completed: true, diagnosis: { severity: "SEV1", conclusion_status: "supported" } });
    expect(JSON.parse(buildInvestigationJson(inherited)).result.completed).toBeNull();
    const frozen = Object.freeze({ ...result });
    const before = JSON.stringify(frozen);
    buildInvestigationMarkdown(frozen, context, { includeRawEvidence: true });
    buildInvestigationJson(frozen, context);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("safely fences embedded source backticks and escapes IDs in headings", () => {
    const observation = "```\nsource output\n`````";
    const source = { ...result, trace: [{ ...result.trace[0], observation }], evidence: [{ ...metric, id: "evidence\n# injected heading", text: "```` source text" }], decisions: [{ ...result.decisions[0], query: "``` query" }] };
    const markdown = buildInvestigationMarkdown(source, {}, { includeRawEvidence: true });
    expect(markdown).toContain(`\n\`\`\`\`\`\`\n${observation}\n\`\`\`\`\`\`\n`);
    expect(markdown).toContain("\n`````\n```` source text\n`````\n");
    expect(markdown).not.toContain("\n# injected heading");
    expect(markdown).toContain("evidence \\# injected heading");
    expect(markdown).not.toContain("**Raw tool observation:** Not recorded");
  });

  it("supports Chinese labels while preserving result language and source content", () => {
    const markdown = buildInvestigationMarkdown(result, context, { locale: "zh" });
    expect(markdown).toContain("**运行完成状态:** 排查未完成");
    expect(markdown).toContain("**诊断状态:** 证据不足");
    expect(markdown).toContain("**严重等级:** 严重等级未知");
    expect(markdown).toContain("**反驳证据 ID:** e2");
    expect(markdown).toContain("**回滚:** Restore the previous worker limit");
    expect(markdown).toContain("Error rate is 12%.");
    expect(JSON.parse(buildInvestigationJson(result, context, { locale: "zh" })).result.language).toBe("en");
  });
});
