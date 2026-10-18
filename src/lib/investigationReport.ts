import { buildInvestigationEvidenceIndex } from "./investigationEvidence";
import { redactSensitiveValue } from "./requestSafety";
import type { Locale } from "./i18n/messages";

export type InvestigationReportContext = {
  scenario_slug?: string;
  title?: string;
  service?: string;
  max_steps_requested?: number;
  requested_language?: "en" | "zh";
  generated_at?: string;
};
type ReportOptions = { locale?: Locale; includeRawEvidence?: boolean };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item !== null && typeof item === "object" && !Array.isArray(item)).map(record) : [];
}
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function count(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 && Number.isInteger(number) ? number : null;
}
function bool(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function choice<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && values.includes(value as T) ? value as T : null;
}
function measurement(value: unknown, service = false) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const item = record(value);
  const amount = finite(item.value);
  if (amount === null) return null;
  return { ...(service ? { service: text(item.service) } : {}), metric: text(item.metric), value: amount, unit: text(item.unit), window: text(item.window) };
}
function mitigation(value: unknown) {
  return records(value).map(item => ({ action: text(item.action), risk: text(item.risk), rollback: text(item.rollback) }));
}
function toolInput(value: unknown): Record<string, string | number> {
  const source = record(value), result: Record<string, string | number> = {};
  for (const key of ["service", "query", "filter", "to_version", "target_version"]) {
    if (typeof source[key] === "string") result[key] = source[key] as string;
  }
  const limit = finite(source.limit);
  if (limit !== null) result.limit = limit;
  return result;
}

/** Legacy adapters put JSON tool arguments in provenance; omit those raw arguments by default too. */
function evidenceSource(source: string, kind: string, includeRaw: boolean): string {
  if (includeRaw || kind !== "tool_observation") return source;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(source);
  if (!match) return source;
  try {
    const input: unknown = JSON.parse(match[2]);
    if (input !== null && typeof input === "object" && !Array.isArray(input)) return match[1];
  } catch { /* Generic source strings remain provenance metadata. */ }
  return source;
}

const LABELS = {
  en: {
    title: "Investigation evidence report", unknown: "Not recorded", none: "None recorded", unknownSeverity: "Unknown severity",
    complete: "Run completed", incomplete: "Investigation incomplete", unknownCompletion: "Completion not recorded",
    scenario: "Scenario", incidentTitle: "Incident title", requestedSteps: "Requested maximum investigation steps", requestedLanguage: "Requested output language", language: "Result language", generated: "Report generated",
    engine: "Engine version", completion: "Run completion", stop: "Stop reason", steps: "Loop steps",
    conclusion: "Diagnosis status", diagnosis: "Diagnosis", summary: "Summary", severity: "Severity", severityReasoning: "Severity reasoning",
    causes: "Root cause hypotheses", hypothesis: "Hypothesis", supporting: "Supporting evidence IDs", refuting: "Contradicting evidence IDs",
    missing: "Missing evidence", next: "Next discriminating check", claims: "Claims and citations", claimKind: "Claim kind",
    citations: "Evidence IDs", measurement: "Structured measurement", derivation: "Explicit derivation",
    operation: "Operation", operands: "Operand evidence IDs", value: "Value", unit: "Unit", service: "Service", metric: "Metric", window: "Window",
    mitigation: "Mitigation plan", risk: "Risk", rollback: "Rollback", unresolved: "Unresolved information",
    decisions: "Planner decisions", plannerDone: "Planner done gathering evidence", tool: "Tool", reason: "Reason", query: "Planner query",
    trace: "Tool trace", status: "Read status", latency: "Latency (ms)", input: "Tool input", observation: "Raw tool observation",
    evidence: "Evidence records", source: "Source", kind: "Kind", observed: "Observed at", available: "Available at", rawText: "Raw evidence text",
    sourceHash: "Original source content hash", hashNote: "Source hashes identify original evidence records. Omitted or credential-redacted report content cannot be verified against those original hashes.",
    privacy: "Raw evidence export", omitted: "Raw evidence text, tool observations, tool inputs and planner queries are excluded.",
    included: "Raw evidence text, tool observations, whitelisted tool inputs and planner queries are included with known credentials redacted.",
    audit: "Reference audit", cited: "Referenced evidence IDs", unavailable: "Missing evidence IDs", ambiguous: "Ambiguous evidence IDs",
    auditNote: "This audit checks reference presence and duplicate IDs. It does not verify factual support or arithmetic; semantic review remains necessary.",
    usage: "Recorded usage", modelCalls: "Model calls", tokensIn: "Input tokens", tokensOut: "Output tokens", cost: "Cost (USD)",
    analysis: "Presentation response", evidenceSummary: "Evidence summary", likelihood: "Likelihood assessment", investigation: "Investigation checklist", command: "Command", expected: "Expected result",
    impact: "Customer impact", postmortem: "Postmortem draft", follows: "Follow-ups", owner: "Suggested owner role", priority: "Priority",
    statuses: { supported: "Supported", tentative: "Tentative", insufficient_evidence: "Insufficient evidence" },
  },
  zh: {
    title: "故障排查证据报告", unknown: "未记录", none: "未记录任何内容", unknownSeverity: "严重等级未知",
    complete: "排查运行已结束", incomplete: "排查未完成", unknownCompletion: "未记录完成状态",
    scenario: "场景", incidentTitle: "故障标题", requestedSteps: "请求的最大调查步骤数", requestedLanguage: "请求的输出语言", language: "结果语言", generated: "报告生成时间",
    engine: "引擎版本", completion: "运行完成状态", stop: "停止原因", steps: "循环步骤数",
    conclusion: "诊断状态", diagnosis: "诊断", summary: "摘要", severity: "严重等级", severityReasoning: "严重等级理由",
    causes: "根因假设", hypothesis: "假设", supporting: "支持证据 ID", refuting: "反驳证据 ID",
    missing: "缺失证据", next: "下一项区分性检查", claims: "事实陈述与引用", claimKind: "陈述类型",
    citations: "证据 ID", measurement: "结构化测量", derivation: "显式计算",
    operation: "运算", operands: "操作数证据 ID", value: "数值", unit: "单位", service: "服务", metric: "指标", window: "时间窗口",
    mitigation: "缓解方案", risk: "风险", rollback: "回滚", unresolved: "未解决的信息",
    decisions: "规划决策", plannerDone: "规划器已结束证据收集", tool: "工具", reason: "原因", query: "规划器查询",
    trace: "工具调用记录", status: "读取状态", latency: "耗时（毫秒）", input: "工具输入", observation: "原始工具观察结果",
    evidence: "证据记录", source: "来源", kind: "类型", observed: "观察时间", available: "可用时间", rawText: "原始证据文本",
    sourceHash: "原始来源内容哈希", hashNote: "来源哈希标识原始证据记录。报告中省略或已脱敏的内容无法使用原始哈希验证。",
    privacy: "原始证据导出", omitted: "默认不包含原始证据文本、工具观察结果、工具输入和规划器查询。",
    included: "已包含原始证据文本、工具观察结果、白名单工具输入和规划器查询，并已脱敏已知格式的凭据。",
    audit: "引用检查", cited: "被引用的证据 ID", unavailable: "缺失的证据 ID", ambiguous: "存在歧义的证据 ID",
    auditNote: "此检查仅确认引用是否存在及 ID 是否重复，不验证事实支持或计算是否正确；仍需语义审查。",
    usage: "记录的使用量", modelCalls: "模型调用次数", tokensIn: "输入 token", tokensOut: "输出 token", cost: "费用（美元）",
    analysis: "展示用响应", evidenceSummary: "证据摘要", likelihood: "可能性评估", investigation: "排查清单", command: "命令", expected: "预期结果",
    impact: "客户影响", postmortem: "Postmortem 草稿", follows: "后续行动项", owner: "建议负责人角色", priority: "优先级",
    statuses: { supported: "有证据支持", tentative: "暂定", insufficient_evidence: "证据不足" },
  },
} as const;

function reportData(result: unknown, context: InvestigationReportContext, options: ReportOptions) {
  const source = record(result), rawAnalysis = record(source.analysis), rawDiagnosis = record(source.diagnosis), usage = record(source.usage);
  const rawContext = record(context);
  const index = buildInvestigationEvidenceIndex(result);
  const includeRaw = options.includeRawEvidence === true;
  const severity = (value: unknown) => choice(value, ["SEV1", "SEV2", "SEV3"] as const);
  const language = (value: unknown) => choice(value, ["en", "zh"] as const);
  const labels = LABELS[options.locale ?? "en"];
  const payload = {
    schema_version: 1,
    report_type: "investigation_evidence_report",
    context: {
      scenario_slug: text(rawContext.scenario_slug),
      ...(text(rawContext.title) ? { title: text(rawContext.title) } : {}),
      ...(text(rawContext.service) ? { service: text(rawContext.service) } : {}),
      ...(count(rawContext.max_steps_requested) !== null ? { max_steps_requested: count(rawContext.max_steps_requested) } : {}),
      requested_language: language(rawContext.requested_language),
      generated_at: text(rawContext.generated_at),
    },
    privacy: { raw_evidence_included: includeRaw, known_credentials_redacted: true, source_hash_note: labels.hashNote },
    reference_audit: {
      cited_ids: index.citedIds, missing_ids: index.missingIds, ambiguous_ids: index.ambiguousIds,
      semantic_review_required: true, note: labels.auditNote,
    },
    result: {
      engine_version: text(source.engine_version), language: language(source.language), completed: bool(source.completed),
      stop_reason: choice(source.stop_reason, ["single_pass", "model_done", "step_cap", "no_progress", "budget_cap"] as const),
      steps: count(source.steps),
      usage: { model_calls: count(usage.model_calls), tokens_in: count(usage.tokens_in), tokens_out: count(usage.tokens_out), cost_usd: finite(usage.cost_usd) },
      analysis: {
        summary: text(rawAnalysis.summary), severity: severity(rawAnalysis.severity), severity_reasoning: text(rawAnalysis.severity_reasoning),
        root_causes: records(rawAnalysis.root_causes).map(item => ({ hypothesis: text(item.hypothesis), evidence: text(item.evidence), likelihood: choice(item.likelihood, ["unassessed"] as const) })),
        investigation_checklist: records(rawAnalysis.investigation_checklist).map(item => ({ step: text(item.step), command: text(item.command), expected: text(item.expected) })),
        mitigation_plan: mitigation(rawAnalysis.mitigation_plan), customer_impact: text(rawAnalysis.customer_impact), postmortem_draft: text(rawAnalysis.postmortem_draft),
        follow_ups: records(rawAnalysis.follow_ups).map(item => ({ item: text(item.item), owner_role: text(item.owner_role), priority: choice(item.priority, ["P0", "P1", "P2"] as const) })),
      },
      diagnosis: {
        summary: text(rawDiagnosis.summary), conclusion_status: choice(rawDiagnosis.conclusion_status, ["supported", "tentative", "insufficient_evidence"] as const),
        severity: severity(rawDiagnosis.severity), severity_reasoning: text(rawDiagnosis.severity_reasoning),
        root_causes: records(rawDiagnosis.root_causes).map(item => ({ hypothesis: text(item.hypothesis), supporting_ids: strings(item.supporting_ids), refuting_ids: strings(item.refuting_ids), missing_evidence: strings(item.missing_evidence), next_check: text(item.next_check) })),
        claims: records(rawDiagnosis.claims).map(item => {
          const d = record(item.derivation);
          return { id: text(item.id), kind: choice(item.kind, ["observed", "derived", "inference", "hypothesis"] as const), text: text(item.text), evidence_ids: strings(item.evidence_ids),
            measurement: measurement(item.measurement, true),
            derivation: item.derivation && typeof item.derivation === "object" && !Array.isArray(item.derivation)
              ? { operation: choice(d.operation, ["complement_percent", "difference"] as const), operands: strings(d.operands), value: finite(d.value), unit: text(d.unit) } : null,
          };
        }),
        mitigation_plan: mitigation(rawDiagnosis.mitigation_plan), missing_information: strings(rawDiagnosis.missing_information),
      },
      decisions: records(source.decisions).map(item => ({
        done: bool(item.done), tool: choice(item.tool, ["get_metrics", "get_logs", "get_deploy_history", "search_runbooks"] as const), reason: text(item.reason),
        hypotheses: records(item.hypotheses).map(h => ({ hypothesis: text(h.hypothesis), supporting_ids: strings(h.supporting_ids), refuting_ids: strings(h.refuting_ids), missing: text(h.missing) })),
        ...(includeRaw ? { query: text(item.query) } : {}),
      })),
      trace: records(source.trace).map(item => ({
        index: count(item.index), tool: text(item.tool), status: choice(item.status, ["ok", "empty", "refused", "error"] as const), reason: text(item.reason), latency_ms: finite(item.latency_ms),
        evidence_ids: [...new Set(records(item.evidence).map(e => text(e.id)).filter(Boolean))],
        ...(includeRaw ? { input: toolInput(item.input), observation: text(item.observation) } : {}),
      })),
      evidence: index.evidence.map(item => ({
        record_key: item.recordKey, id: item.id, kind: item.kind, source: evidenceSource(item.source, item.kind, includeRaw), service: item.service,
        observed_at: item.observed_at, available_at: item.available_at, source_content_hash: item.source_content_hash,
        measurement: measurement(item.measurement), ...(includeRaw ? { text: item.text } : {}),
      })),
    },
  };
  return redactSensitiveValue(payload);
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
}
function fenced(value: string, language = ""): string {
  const longest = (value.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${value}\n${fence}`;
}

export function buildInvestigationJson(result: unknown, context: InvestigationReportContext = {}, options: ReportOptions = {}): string {
  return `${JSON.stringify(reportData(result, context, options), null, 2)}\n`;
}

export function buildInvestigationMarkdown(result: unknown, context: InvestigationReportContext = {}, options: ReportOptions = {}): string {
  const report = reportData(result, context, options), r = report.result, d = r.diagnosis, a = r.analysis;
  const l = LABELS[options.locale ?? "en"], lines: string[] = [`# ${l.title}`, ""];
  const value = (item: string | number | boolean | null | undefined) => item === null || item === undefined || item === "" ? l.unknown : String(item);
  const field = (label: string, item: string | number | boolean | null | undefined) => { lines.push(`**${label}:** ${value(item)}`, ""); };
  const detail = (label: string) => { lines.push(`**${label}:**`, ""); };
  const ids = (items: string[]) => items.length ? items.map(oneLine).join(", ") : l.none;
  const section = (label: string, depth = 2) => { lines.push(`${"#".repeat(depth)} ${label}`, ""); };
  const list = (items: string[]) => { lines.push(...(items.length ? items.map(item => `- ${item}`) : [l.none]), ""); };
  const mitigations = (items: typeof d.mitigation_plan, depth = 3) => {
    if (!items.length) lines.push(l.none, "");
    for (const [i, item] of items.entries()) { lines.push(`${"#".repeat(depth)} ${i + 1}. ${oneLine(item.action || l.unknown)}`, ""); field(l.risk, item.risk); field(l.rollback, item.rollback); }
  };
  field(l.completion, r.completed === false ? l.incomplete : r.completed === true ? l.complete : l.unknownCompletion);
  field(l.stop, r.stop_reason); field(l.conclusion, d.conclusion_status ? l.statuses[d.conclusion_status] : null); field(l.severity, d.severity ?? l.unknownSeverity);
  for (const [label, item] of [[l.scenario, report.context.scenario_slug], [l.incidentTitle, report.context.title], [l.service, report.context.service], [l.requestedSteps, report.context.max_steps_requested], [l.requestedLanguage, report.context.requested_language], [l.language, r.language], [l.generated, report.context.generated_at], [l.engine, r.engine_version]] as const) field(label, typeof item === "string" ? oneLine(item) : item);
  field(l.privacy, report.privacy.raw_evidence_included ? l.included : l.omitted);
  lines.push(l.hashNote, "");

  section(l.audit); lines.push(l.auditNote, ""); field(l.cited, ids(report.reference_audit.cited_ids)); field(l.unavailable, ids(report.reference_audit.missing_ids)); field(l.ambiguous, ids(report.reference_audit.ambiguous_ids));
  section(l.diagnosis); lines.push(d.summary || l.unknown, ""); field(l.severityReasoning, d.severity_reasoning);
  section(l.causes);
  if (!d.root_causes.length) lines.push(l.none, "");
  for (const [i, cause] of d.root_causes.entries()) {
    lines.push(`### ${i + 1}. ${oneLine(cause.hypothesis || l.unknown)}`, "");
    field(l.supporting, ids(cause.supporting_ids)); field(l.refuting, ids(cause.refuting_ids)); field(l.missing, cause.missing_evidence.join("; ")); field(l.next, cause.next_check);
  }
  section(l.claims);
  if (!d.claims.length) lines.push(l.none, "");
  for (const [i, claim] of d.claims.entries()) {
    lines.push(`### ${oneLine(claim.id || String(i + 1))}`, "", claim.text || l.unknown, ""); field(l.claimKind, claim.kind); field(l.citations, ids(claim.evidence_ids));
    if (claim.measurement) { detail(l.measurement); lines.push(fenced(JSON.stringify(claim.measurement, null, 2), "json"), ""); }
    if (claim.derivation) {
      detail(l.derivation); field(l.operation, claim.derivation.operation); field(l.operands, ids(claim.derivation.operands)); field(l.value, claim.derivation.value); field(l.unit, claim.derivation.unit);
    }
  }
  section(l.mitigation); mitigations(d.mitigation_plan);
  section(l.unresolved); list(d.missing_information);

  section(l.decisions);
  if (!r.decisions.length) lines.push(l.none, "");
  for (const [i, decision] of r.decisions.entries()) {
    lines.push(`### ${i + 1}. ${oneLine(decision.tool || l.unknown)}`, ""); field(l.plannerDone, decision.done); field(l.reason, decision.reason);
    if ("query" in decision) { detail(l.query); lines.push(fenced(decision.query || ""), ""); }
    for (const h of decision.hypotheses) { field(l.hypothesis, h.hypothesis); field(l.supporting, ids(h.supporting_ids)); field(l.refuting, ids(h.refuting_ids)); field(l.missing, h.missing); }
  }
  section(l.trace);
  if (!r.trace.length) lines.push(l.none, "");
  for (const step of r.trace) {
    lines.push(`### ${value(step.index)}. ${oneLine(step.tool || l.unknown)}`, ""); field(l.status, step.status); field(l.reason, step.reason); field(l.latency, step.latency_ms); field(l.citations, ids(step.evidence_ids));
    if ("input" in step) { detail(l.input); lines.push(fenced(JSON.stringify(step.input, null, 2), "json"), ""); }
    if ("observation" in step) { detail(l.observation); lines.push(fenced(step.observation || ""), ""); }
  }
  section(l.evidence);
  if (!r.evidence.length) lines.push(l.none, "");
  for (const item of r.evidence) {
    lines.push(`### ${oneLine(item.id || l.unknown)} (${oneLine(item.record_key)})`, "");
    field(l.kind, oneLine(item.kind)); field(l.source, oneLine(item.source)); field(l.service, oneLine(item.service)); field(l.observed, oneLine(item.observed_at)); field(l.available, oneLine(item.available_at)); field(l.sourceHash, oneLine(item.source_content_hash));
    if (item.measurement) { detail(l.measurement); lines.push(fenced(JSON.stringify(item.measurement, null, 2), "json"), ""); }
    if ("text" in item) { detail(l.rawText); lines.push(fenced(item.text || ""), ""); }
  }

  section(l.usage); field(l.steps, r.steps); field(l.modelCalls, r.usage.model_calls); field(l.tokensIn, r.usage.tokens_in); field(l.tokensOut, r.usage.tokens_out); field(l.cost, r.usage.cost_usd);
  section(l.analysis); section(l.summary, 3); lines.push(a.summary || l.unknown, ""); field(l.severity, a.severity ?? l.unknownSeverity); field(l.severityReasoning, a.severity_reasoning);
  section(l.causes, 3);
  if (!a.root_causes.length) lines.push(l.none, "");
  for (const cause of a.root_causes) { field(l.hypothesis, cause.hypothesis); field(l.evidenceSummary, cause.evidence); field(l.likelihood, cause.likelihood); }
  section(l.investigation, 3);
  if (!a.investigation_checklist.length) lines.push(l.none, "");
  for (const [i, step] of a.investigation_checklist.entries()) {
    lines.push(`#### ${i + 1}. ${oneLine(step.step || l.unknown)}`, ""); detail(l.command); lines.push(step.command ? fenced(step.command) : l.unknown, ""); field(l.expected, step.expected);
  }
  section(l.mitigation, 3); mitigations(a.mitigation_plan, 4);
  section(l.impact, 3); lines.push(a.customer_impact || l.unknown, "");
  section(l.postmortem, 3); lines.push(a.postmortem_draft || l.unknown, "");
  section(l.follows, 3);
  if (!a.follow_ups.length) lines.push(l.none, "");
  for (const follow of a.follow_ups) { lines.push(`- ${follow.item || l.unknown}`, ""); field(l.owner, follow.owner_role); field(l.priority, follow.priority); }
  return `${lines.join("\n").trimEnd()}\n`;
}
