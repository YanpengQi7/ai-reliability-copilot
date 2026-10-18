import type { InvestigationResult } from "./agent/types";
import type { InvestigationReportContext } from "./investigationReport";
import type { Locale } from "./i18n/messages";
import { redactSensitiveValue } from "./requestSafety";

export type InvestigationComparisonRun = { result: InvestigationResult; context?: InvestigationReportContext };

const LABELS = {
  en: {
    title: "Investigation comparison", previous: "Previous run", latest: "Latest run", scenario: "Scenario", titleField: "Incident", service: "Service", stepsRequested: "Requested maximum steps", conclusion: "Conclusion", severity: "Severity", completed: "Completed", stopReason: "Stop reason", steps: "Steps used", evidenceCount: "Evidence records", modelCalls: "Model calls", tokens: "Tokens in / out", cost: "Cost (USD)", summary: "Diagnosis summary", hypotheses: "Root cause hypotheses", claims: "Evidence-backed claims", evidenceIds: "Evidence IDs", added: "Added", removed: "Removed", none: "None", yes: "Yes", no: "No", unknown: "Unknown", note: "Runs may use different incident details or depth settings. Differences show investigator output only and do not confirm incident state.", privacy: "Raw evidence text and tool observations are excluded. Narrative fields may still quote evidence. Known credential formats are redacted; detection is not exhaustive.", statuses: { supported: "Supported", tentative: "Tentative", insufficient_evidence: "Insufficient evidence" },
  },
  zh: {
    title: "调查结果对比", previous: "上次调查", latest: "本次调查", scenario: "场景", titleField: "故障", service: "服务", stepsRequested: "请求的最大步骤数", conclusion: "诊断结论", severity: "严重等级", completed: "已完成", stopReason: "停止原因", steps: "已用步骤", evidenceCount: "证据记录", modelCalls: "模型调用", tokens: "输入 / 输出 Token", cost: "费用（美元）", summary: "诊断摘要", hypotheses: "根因假设", claims: "有证据引用的结论", evidenceIds: "证据 ID", added: "新增", removed: "移除", none: "无", yes: "是", no: "否", unknown: "未知", note: "两次调查可能使用不同的故障信息或调查深度。差异仅反映调查输出，不能确认故障状态。", privacy: "不包含原始证据文本和工具观察记录。叙述字段仍可能引用证据。已知格式的凭据会脱敏，但检测并非穷尽。", statuses: { supported: "有证据支持", tentative: "暂定", insufficient_evidence: "证据不足" },
  },
} as const;

function strings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function changes(before: string[], after: string[], exact = false) {
  const a = strings(before), b = strings(after);
  const key = (value: string) => exact ? value : value.toLocaleLowerCase();
  const beforeKeys = new Set(a.map(key)), afterKeys = new Set(b.map(key));
  return { added: b.filter(value => !beforeKeys.has(key(value))), removed: a.filter(value => !afterKeys.has(key(value))) };
}

function safeRun({ result, context }: InvestigationComparisonRun, locale: Locale) {
  const labels = LABELS[locale];
  return {
    context: {
      scenario_slug: context?.scenario_slug ?? "",
      title: context?.title ?? "",
      service: context?.service ?? "",
      requested_language: context?.requested_language ?? result.language,
      max_steps_requested: context?.max_steps_requested ?? null,
      generated_at: context?.generated_at ?? "",
    },
    result: {
      completed: result.completed,
      stop_reason: result.stop_reason,
      steps: result.steps,
      severity: result.diagnosis.severity ?? labels.unknown,
      conclusion_status: labels.statuses[result.diagnosis.conclusion_status],
      summary: result.diagnosis.summary,
      root_cause_hypotheses: strings(result.diagnosis.root_causes.map(item => item.hypothesis)),
      claims: strings(result.diagnosis.claims.map(item => item.text)),
      evidence_ids: strings((result.evidence ?? []).map(item => item.id)),
      evidence_count: result.evidence?.length ?? 0,
      model_calls: result.usage.model_calls,
      tokens_in: result.usage.tokens_in,
      tokens_out: result.usage.tokens_out,
      cost_usd: result.usage.cost_usd,
    },
  };
}

function payload(previous: InvestigationComparisonRun, latest: InvestigationComparisonRun, locale: Locale) {
  const labels = LABELS[locale];
  const before = safeRun(previous, locale), after = safeRun(latest, locale);
  return redactSensitiveValue({
    schema_version: 1,
    report_type: "investigation_comparison",
    note: labels.note,
    privacy: labels.privacy,
    previous: before,
    latest: after,
    changes: {
      severity_changed: before.result.severity !== after.result.severity,
      conclusion_changed: before.result.conclusion_status !== after.result.conclusion_status,
      hypotheses: changes(before.result.root_cause_hypotheses, after.result.root_cause_hypotheses),
      claims: changes(before.result.claims, after.result.claims),
      evidence_ids: changes(before.result.evidence_ids, after.result.evidence_ids, true),
    },
  });
}

export function buildInvestigationComparisonJson(previous: InvestigationComparisonRun, latest: InvestigationComparisonRun, locale: Locale = "en"): string {
  return `${JSON.stringify(payload(previous, latest, locale), null, 2)}\n`;
}

export function buildInvestigationComparisonMarkdown(previous: InvestigationComparisonRun, latest: InvestigationComparisonRun, locale: Locale = "en"): string {
  const labels = LABELS[locale], report = payload(previous, latest, locale);
  const run = (label: string, item: typeof report.previous) => [
    `## ${label}`, "",
    `- **${labels.scenario}:** ${item.context.scenario_slug || labels.unknown}`,
    `- **${labels.titleField}:** ${item.context.title || labels.unknown}`,
    `- **${labels.service}:** ${item.context.service || labels.unknown}`,
    `- **${labels.stepsRequested}:** ${item.context.max_steps_requested ?? labels.unknown}`,
    `- **${labels.conclusion}:** ${item.result.conclusion_status}`,
    `- **${labels.severity}:** ${item.result.severity}`,
    `- **${labels.completed}:** ${item.result.completed ? labels.yes : labels.no}`,
    `- **${labels.stopReason}:** ${item.result.stop_reason}`,
    `- **${labels.steps}:** ${item.result.steps}`,
    `- **${labels.evidenceCount}:** ${item.result.evidence_count}`,
    `- **${labels.modelCalls}:** ${item.result.model_calls}`,
    `- **${labels.tokens}:** ${item.result.tokens_in} / ${item.result.tokens_out}`,
    `- **${labels.cost}:** ${item.result.cost_usd.toFixed(5)}`,
    "", `### ${labels.summary}`, "", item.result.summary, "",
  ];
  const listDiff = (label: string, diff: { added: string[]; removed: string[] }) => [
    `### ${label}`, "",
    `**${labels.added}:**`, ...(diff.added.length ? diff.added.map(value => `- ${value}`) : [`- ${labels.none}`]), "",
    `**${labels.removed}:**`, ...(diff.removed.length ? diff.removed.map(value => `- ${value}`) : [`- ${labels.none}`]), "",
  ];
  return [
    `# ${labels.title}`, "", report.note, "", report.privacy, "",
    ...run(labels.previous, report.previous), ...run(labels.latest, report.latest),
    ...listDiff(labels.hypotheses, report.changes.hypotheses),
    ...listDiff(labels.claims, report.changes.claims),
    ...listDiff(labels.evidenceIds, report.changes.evidence_ids),
    `- **${labels.severity}:** ${report.changes.severity_changed ? labels.yes : labels.no}`,
    `- **${labels.conclusion}:** ${report.changes.conclusion_changed ? labels.yes : labels.no}`,
    "",
  ].join("\n");
}
