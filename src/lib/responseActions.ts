import { normalizeAnalysisContent, type ReportContext } from "./analysisReview";
import { redactSensitiveValue } from "./requestSafety";
import type { Locale } from "./i18n/messages";

export type ActionStatus = "todo" | "in_progress" | "blocked" | "done";
export type ActionCategory = "investigation" | "mitigation" | "follow_up";
export type ResponseAction = {
  id: string;
  category: ActionCategory;
  title: string;
  command: string;
  expected: string;
  risk: string;
  rollback: string;
  suggestedOwner: string;
  priority: string;
};
export type ActionProgress = { status: ActionStatus; owner: string; outcome: string };
export type ResponseProgress = Record<string, ActionProgress>;

export const RESPONSE_LIMITS = { owner: 120, outcome: 4000, storageChars: 250_000 } as const;
const STATUSES: readonly ActionStatus[] = ["todo", "in_progress", "blocked", "done"];
const CATEGORIES: readonly ActionCategory[] = ["investigation", "mitigation", "follow_up"];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function action(category: ActionCategory, index: number, fields: Partial<ResponseAction>): ResponseAction {
  return {
    id: `${category}:${index}`, category, title: "", command: "", expected: "",
    risk: "", rollback: "", suggestedOwner: "", priority: "", ...fields,
  };
}

/** IDs identify positions only; the caller scopes progress to the exact analysis. */
export function buildResponseActions(analysis: unknown): ResponseAction[] {
  const content = normalizeAnalysisContent(analysis);
  return [
    ...content.investigation_checklist.map((check, index) => action("investigation", index, {
      title: check.step, command: check.command, expected: check.expected,
    })),
    ...content.mitigation_plan.map((mitigation, index) => action("mitigation", index, {
      title: mitigation.action, risk: mitigation.risk, rollback: mitigation.rollback,
    })),
    ...content.follow_ups.map((follow, index) => action("follow_up", index, {
      title: follow.item, suggestedOwner: follow.owner_role, priority: follow.priority,
    })),
  ];
}

export function getActionProgress(progress: ResponseProgress, id: string): ActionProgress {
  const values = record(progress);
  const entry = Object.hasOwn(values, id) ? record(values[id]) : {};
  const status = Object.hasOwn(entry, "status") ? entry.status : undefined;
  return {
    status: STATUSES.includes(status as ActionStatus) ? status as ActionStatus : "todo",
    owner: Object.hasOwn(entry, "owner") ? text(entry.owner) : "",
    outcome: Object.hasOwn(entry, "outcome") ? text(entry.outcome) : "",
  };
}

/** Retain only current actions and bounded operator fields, without mutating input. */
export function sanitizeResponseProgress(actions: readonly ResponseAction[], input: unknown): ResponseProgress {
  const values = record(input);
  const entries: Array<[string, ActionProgress]> = [];
  for (const source of actions) {
    if (!Object.hasOwn(values, source.id)) continue;
    const entry = getActionProgress(values as ResponseProgress, source.id);
    const progress = {
      status: entry.status,
      owner: redactSensitiveValue(entry.owner).slice(0, RESPONSE_LIMITS.owner),
      outcome: redactSensitiveValue(entry.outcome).slice(0, RESPONSE_LIMITS.outcome),
    };
    if (progress.status !== "todo" || progress.owner || progress.outcome) entries.push([source.id, progress]);
  }
  // Object.fromEntries treats __proto__ as data rather than a prototype setter.
  return Object.fromEntries(entries);
}

export function summarizeResponseProgress(actions: readonly ResponseAction[], progress: ResponseProgress): {
  total: number; todo: number; in_progress: number; blocked: number; done: number;
} {
  const counts = { total: actions.length, todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const source of actions) counts[getActionProgress(progress, source.id).status] += 1;
  return counts;
}

const LABELS = {
  en: {
    title: "Response action handoff", manual: "Statuses, assigned owners and observed outcomes are recorded manually by the operator.",
    incident: "Incident", service: "Affected service", incidentId: "Incident ID", analysisId: "Analysis ID",
    model: "Model", prompt: "Prompt version", language: "Output language", created: "Analysis created",
    summary: "Incident summary", severity: "Severity", severityReasoning: "Severity reasoning",
    progress: "Progress", total: "Total", blockers: "Blockers", next: "Next actions", none: "None",
    notRecorded: "Not recorded", untitled: "Untitled action", recommendations: "Source recommendation",
    operator: "Operator record", status: "Status", owner: "Assigned owner", outcome: "Observed outcome / notes",
    command: "Command to investigate", expected: "Expected result", risk: "Risk", rollback: "Rollback",
    suggestedOwner: "Suggested owner role", priority: "Priority",
    categories: { investigation: "Investigation checks", mitigation: "Mitigation actions", follow_up: "Follow-ups" },
    statuses: { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" },
  },
  zh: {
    title: "故障响应行动交接", manual: "状态、实际负责人和观察结果由操作人员手动记录。",
    incident: "故障", service: "受影响服务", incidentId: "故障 ID", analysisId: "分析 ID",
    model: "模型", prompt: "Prompt 版本", language: "输出语言", created: "分析创建时间",
    summary: "故障摘要", severity: "严重等级", severityReasoning: "严重等级理由",
    progress: "进度", total: "总计", blockers: "阻塞项", next: "下一步行动", none: "无",
    notRecorded: "未记录", untitled: "未命名行动", recommendations: "原始建议",
    operator: "操作人员记录", status: "状态", owner: "实际负责人", outcome: "观察结果 / 笔记",
    command: "排查命令", expected: "预期结果", risk: "风险", rollback: "回滚",
    suggestedOwner: "建议负责人角色", priority: "优先级",
    categories: { investigation: "排查步骤", mitigation: "缓解行动", follow_up: "后续行动项" },
    statuses: { todo: "待办", in_progress: "进行中", blocked: "受阻", done: "已完成" },
  },
} as const;

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
}

function fenced(value: string): string {
  const longest = (value.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${value}\n${fence}`;
}

function handoffData(analysis: unknown, context: ReportContext, progress: ResponseProgress) {
  const content = redactSensitiveValue(normalizeAnalysisContent(analysis));
  const allowedContext = redactSensitiveValue({
    id: text(context.incident_id) || text(context.id) || content.incident_id,
    title: text(context.title), service: text(context.service),
  });
  const actions = buildResponseActions(content);
  const safeProgress = sanitizeResponseProgress(actions, progress);
  return {
    content,
    incident: allowedContext,
    actions,
    progress: safeProgress,
    summary: summarizeResponseProgress(actions, safeProgress),
    blockers: actions.filter(source => getActionProgress(safeProgress, source.id).status === "blocked"),
    next: actions.filter(source => getActionProgress(safeProgress, source.id).status !== "done"),
  };
}

export function buildResponseHandoffMarkdown(
  analysis: unknown,
  context: ReportContext,
  progress: ResponseProgress,
  options: { locale?: Locale } = {},
): string {
  const labels = LABELS[options.locale ?? "en"];
  const data = handoffData(analysis, context, progress);
  const value = (content: string) => content.trim() ? content : labels.notRecorded;
  const lines = [`# ${labels.title}${data.incident.title ? `: ${oneLine(data.incident.title)}` : ""}`, "", labels.manual, ""];
  const metadata = [
    [labels.incidentId, data.incident.id], [labels.incident, data.incident.title],
    [labels.service, data.incident.service], [labels.analysisId, data.content.id],
    [labels.model, data.content.model], [labels.prompt, data.content.prompt_version],
    [labels.language, data.content.output_language], [labels.created, data.content.created_at],
  ];
  for (const [label, content] of metadata) if (content) lines.push(`- **${label}:** ${oneLine(content)}`);
  lines.push("", `## ${labels.summary}`, "", value(data.content.summary), "",
    `**${labels.severity}:** ${value(data.content.severity)}`, "",
    `**${labels.severityReasoning}:** ${value(data.content.severity_reasoning)}`, "",
    `## ${labels.progress}`, "",
    `${labels.total}: ${data.summary.total} · ${STATUSES.map(status => `${labels.statuses[status]}: ${data.summary[status]}`).join(" · ")}`, "");
  for (const [title, sources] of [[labels.blockers, data.blockers], [labels.next, data.next]] as const) {
    lines.push(`## ${title}`, "");
    if (!sources.length) lines.push(labels.none);
    for (const source of sources) {
      const recorded = getActionProgress(data.progress, source.id);
      lines.push(`- ${source.id} · ${labels.statuses[recorded.status]} · ${oneLine(source.title || labels.untitled)}${recorded.owner ? ` · ${labels.owner}: ${oneLine(recorded.owner)}` : ""}`);
    }
    lines.push("");
  }
  for (const category of CATEGORIES) {
    lines.push(`## ${labels.categories[category]}`, "");
    const sources = data.actions.filter(source => source.category === category);
    if (!sources.length) lines.push(labels.none, "");
    for (const [index, source] of sources.entries()) {
      const recorded = getActionProgress(data.progress, source.id);
      lines.push(`### ${index + 1}. ${oneLine(source.title || labels.untitled)} (${source.id})`, "", `**${labels.recommendations}**`, "");
      if (category === "investigation") {
        lines.push(`**${labels.command}:**`, "", source.command ? fenced(source.command) : labels.notRecorded, "",
          `**${labels.expected}:** ${value(source.expected)}`, "");
      } else if (category === "mitigation") {
        lines.push(`**${labels.risk}:** ${value(source.risk)}`, "", `**${labels.rollback}:** ${value(source.rollback)}`, "");
      } else {
        lines.push(`**${labels.suggestedOwner}:** ${value(source.suggestedOwner)}`, "", `**${labels.priority}:** ${value(source.priority)}`, "");
      }
      lines.push(`**${labels.operator}**`, "", `**${labels.status}:** ${labels.statuses[recorded.status]}`, "",
        `**${labels.owner}:** ${oneLine(value(recorded.owner))}`, "", `**${labels.outcome}:**`, "",
        recorded.outcome.trim() ? fenced(recorded.outcome) : labels.notRecorded, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildResponseHandoffJson(
  analysis: unknown,
  context: ReportContext,
  progress: ResponseProgress,
  options: { locale?: Locale } = {},
): string {
  const data = handoffData(analysis, context, progress);
  return `${JSON.stringify({
    record_type: "operator_recorded_response_handoff",
    locale: options.locale ?? "en",
    incident: data.incident,
    analysis: {
      id: data.content.id, incident_id: data.content.incident_id,
      model: data.content.model, prompt_version: data.content.prompt_version,
      output_language: data.content.output_language, created_at: data.content.created_at,
      summary: data.content.summary, severity: data.content.severity, severity_reasoning: data.content.severity_reasoning,
    },
    progress_summary: data.summary,
    blockers: data.blockers.map(source => source.id),
    next_actions: data.next.map(source => source.id),
    actions: data.actions.map(source => ({ recommendation: source, operator_record: getActionProgress(data.progress, source.id) })),
  }, null, 2)}\n`;
}
