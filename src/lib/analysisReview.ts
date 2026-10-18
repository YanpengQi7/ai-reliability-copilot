import { t, type Locale } from "./i18n/messages";

/** Browser-safe input shared by streamed results and saved, possibly older rows. */
export type AnalysisContent = {
  id?: string | null;
  incident_id?: string | null;
  model?: string | null;
  prompt_version?: string | null;
  output_language?: string | null;
  created_at?: string | null;
  summary?: string | null;
  severity?: string | null;
  severity_reasoning?: string | null;
  root_causes?: unknown;
  investigation_checklist?: unknown;
  mitigation_plan?: unknown;
  customer_impact?: string | null;
  postmortem_draft?: string | null;
  follow_ups?: unknown;
  latency_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | string | null;
};

export type ReportContext = {
  id?: string | null;
  incident_id?: string | null;
  title?: string | null;
  service?: string | null;
  symptoms?: string | null;
  raw_context?: string | null;
};

export type RootCauseContent = { hypothesis: string; evidence: string; likelihood: string };
export type InvestigationContent = { step: string; command: string; expected: string };
export type MitigationContent = { action: string; risk: string; rollback: string };
export type FollowUpContent = { item: string; owner_role: string; priority: string };

export type NormalizedAnalysisContent = {
  id: string | null;
  incident_id: string | null;
  model: string | null;
  prompt_version: string | null;
  output_language: string | null;
  created_at: string | null;
  summary: string;
  severity: string;
  severity_reasoning: string;
  root_causes: RootCauseContent[];
  investigation_checklist: InvestigationContent[];
  mitigation_plan: MitigationContent[];
  customer_impact: string;
  postmortem_draft: string;
  follow_ups: FollowUpContent[];
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
};

export type AnalysisSectionKey =
  | "summary" | "severity" | "severity_reasoning" | "root_causes"
  | "investigation_checklist" | "mitigation_plan" | "customer_impact"
  | "postmortem_draft" | "follow_ups";

export type AnalysisSectionValue = string | RootCauseContent[] | InvestigationContent[] | MitigationContent[] | FollowUpContent[];
export type AnalysisSection = { key: AnalysisSectionKey; labelKey: string; value: AnalysisSectionValue };
export type AnalysisSectionComparison = Omit<AnalysisSection, "value"> & {
  before: AnalysisSectionValue;
  after: AnalysisSectionValue;
  changed: boolean;
};

const SECTION_LABELS: ReadonlyArray<[AnalysisSectionKey, string]> = [
  ["summary", "section.summary"],
  ["severity", "section.severity"],
  ["severity_reasoning", "section.severityReasoning"],
  ["root_causes", "section.rootCauses"],
  ["investigation_checklist", "section.investigation"],
  ["mitigation_plan", "section.mitigation"],
  ["customer_impact", "section.customerImpact"],
  ["postmortem_draft", "section.postmortem"],
  ["follow_ups", "section.followUps"],
];

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}

function string(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function nullableString(input: unknown): string | null {
  return typeof input === "string" ? input : null;
}

function finiteNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function contentArray<K extends string>(input: unknown, keys: readonly K[]): Record<K, string>[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap(item => {
    const value = record(item);
    const normalized = Object.fromEntries(keys.map(key => [key, string(value[key])])) as Record<K, string>;
    // Keep incomplete records when they contain useful text, but discard junk.
    return keys.some(key => normalized[key].trim()) ? [normalized] : [];
  });
}

/** Whitelisting also prevents legacy or unknown fields leaking into downloads. */
export function normalizeAnalysisContent(input: unknown): NormalizedAnalysisContent {
  const value = record(input);
  const cost = typeof value.cost_usd === "string" && value.cost_usd.trim()
    ? Number(value.cost_usd) : value.cost_usd;
  return {
    id: nullableString(value.id),
    incident_id: nullableString(value.incident_id),
    model: nullableString(value.model),
    prompt_version: nullableString(value.prompt_version),
    output_language: nullableString(value.output_language),
    created_at: nullableString(value.created_at),
    summary: string(value.summary),
    severity: string(value.severity),
    severity_reasoning: string(value.severity_reasoning),
    root_causes: contentArray(value.root_causes, ["hypothesis", "evidence", "likelihood"]),
    investigation_checklist: contentArray(value.investigation_checklist, ["step", "command", "expected"]),
    mitigation_plan: contentArray(value.mitigation_plan, ["action", "risk", "rollback"]),
    customer_impact: string(value.customer_impact),
    postmortem_draft: string(value.postmortem_draft),
    follow_ups: contentArray(value.follow_ups, ["item", "owner_role", "priority"]),
    latency_ms: finiteNumber(value.latency_ms),
    tokens_in: finiteNumber(value.tokens_in),
    tokens_out: finiteNumber(value.tokens_out),
    cost_usd: finiteNumber(cost),
  };
}

export function getAnalysisSections(content: unknown): AnalysisSection[] {
  const normalized = normalizeAnalysisContent(content);
  return SECTION_LABELS.map(([key, labelKey]) => ({ key, labelKey, value: normalized[key] }));
}

/** Content comparison preserves ranked/checklist order and excludes run metadata. */
export function compareAnalysisSections(baseline: unknown, current: unknown): AnalysisSectionComparison[] {
  const before = getAnalysisSections(baseline);
  return getAnalysisSections(current).map((section, index) => ({
    key: section.key,
    labelKey: section.labelKey,
    before: before[index].value,
    after: section.value,
    // Normalization emits known fields in a stable order, regardless of input key order.
    changed: JSON.stringify(before[index].value) !== JSON.stringify(section.value),
  }));
}

const REPORT_LABELS = {
  en: {
    title: "Incident analysis", severity: "Severity", notRecorded: "Not recorded",
    hypotheses: "Root causes are hypotheses to verify against evidence.",
    incidentId: "Incident ID", analysisId: "Analysis ID", service: "Affected service",
    symptoms: "Symptoms", model: "Model", prompt: "Prompt version", language: "Output language",
    created: "Analysis created", likelihood: "Likelihood", owner: "Owner role", priority: "Priority",
    latency: "Latency (ms)", tokensIn: "Input tokens", tokensOut: "Output tokens", cost: "Cost (USD)",
  },
  zh: {
    title: "故障分析", severity: "严重等级", notRecorded: "未记录",
    hypotheses: "根因是假设，需要通过证据验证。",
    incidentId: "故障 ID", analysisId: "分析 ID", service: "受影响服务",
    symptoms: "症状", model: "模型", prompt: "Prompt 版本", language: "输出语言",
    created: "分析创建时间", likelihood: "可能性", owner: "负责人角色", priority: "优先级",
    latency: "耗时（毫秒）", tokensIn: "输入 token", tokensOut: "输出 token", cost: "费用（美元）",
  },
} as const;

function oneLine(input: string): string {
  return input.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
}

/** Commands and raw context may themselves contain Markdown fences. */
function fenced(input: string, language = ""): string {
  const longest = Math.max(0, ...(input.match(/`+/g) ?? []).map(run => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${input}\n${fence}`;
}

function sectionLabel(locale: Locale, labelKey: string): string {
  if (labelKey === "section.severity") return REPORT_LABELS[locale].severity;
  return t(locale, labelKey).replace(/[:：]\s*$/, "");
}

export function buildAnalysisMarkdown(
  content: unknown,
  context: ReportContext = {},
  options: { includeRawContext?: boolean; locale?: Locale } = {},
): string {
  const locale = options.locale ?? "en";
  const labels = REPORT_LABELS[locale];
  const analysis = normalizeAnalysisContent(content);
  const incidentId = nullableString(context.incident_id) ?? nullableString(context.id) ?? analysis.incident_id;
  const title = string(context.title).trim() || string(context.service).trim() || labels.title;
  const lines = [`# ${oneLine(title)}`, "", `> ${labels.hypotheses}`, ""];
  const metadata: Array<[string, string | null]> = [
    [labels.incidentId, incidentId], [labels.analysisId, analysis.id],
    [labels.service, nullableString(context.service)], [labels.symptoms, nullableString(context.symptoms)],
    [labels.model, analysis.model], [labels.prompt, analysis.prompt_version],
    [labels.language, analysis.output_language], [labels.created, analysis.created_at],
    [labels.latency, analysis.latency_ms == null ? null : String(analysis.latency_ms)],
    [labels.tokensIn, analysis.tokens_in == null ? null : String(analysis.tokens_in)],
    [labels.tokensOut, analysis.tokens_out == null ? null : String(analysis.tokens_out)],
    [labels.cost, analysis.cost_usd == null ? null : String(analysis.cost_usd)],
  ];
  for (const [label, value] of metadata) {
    if (value) lines.push(`- **${label}:** ${oneLine(value)}`);
  }
  lines.push("");
  const text = (value: string) => value.trim() ? value : labels.notRecorded;
  for (const section of getAnalysisSections(analysis)) {
    lines.push(`## ${sectionLabel(locale, section.labelKey)}`, "");
    if (typeof section.value === "string") {
      lines.push(text(section.value));
    } else if (!section.value.length) {
      lines.push(labels.notRecorded);
    } else if (section.key === "root_causes") {
      for (const [index, cause] of analysis.root_causes.entries()) {
        lines.push(`### ${index + 1}. ${oneLine(text(cause.hypothesis))}`, "",
          `${labels.likelihood}: ${text(cause.likelihood)}`, "",
          `${t(locale, "section.evidence")} ${text(cause.evidence)}`, "");
      }
    } else if (section.key === "investigation_checklist") {
      for (const [index, check] of analysis.investigation_checklist.entries()) {
        lines.push(`### ${index + 1}. ${oneLine(text(check.step))}`, "");
        if (check.command) lines.push(fenced(check.command), "");
        lines.push(`${t(locale, "section.expected")} ${text(check.expected)}`, "");
      }
    } else if (section.key === "mitigation_plan") {
      for (const [index, mitigation] of analysis.mitigation_plan.entries()) {
        lines.push(`### ${index + 1}. ${oneLine(text(mitigation.action))}`, "",
          `${t(locale, "section.risk")} ${text(mitigation.risk)}`, "",
          `${t(locale, "section.rollback")} ${text(mitigation.rollback)}`, "");
      }
    } else if (section.key === "follow_ups") {
      for (const follow of analysis.follow_ups) {
        lines.push(`- ${text(follow.item)} — ${labels.owner}: ${text(follow.owner_role)}; ${labels.priority}: ${text(follow.priority)}`);
      }
    }
    lines.push("");
  }
  if (options.includeRawContext && typeof context.raw_context === "string") {
    lines.push(`## ${t(locale, "detail.rawContext")}`, "", fenced(context.raw_context, "text"), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildAnalysisJson(
  content: unknown,
  context: ReportContext = {},
  options: { includeRawContext?: boolean } = {},
): string {
  const analysis = normalizeAnalysisContent(content);
  const incident = {
    id: nullableString(context.incident_id) ?? nullableString(context.id) ?? analysis.incident_id,
    title: nullableString(context.title),
    service: nullableString(context.service),
    symptoms: nullableString(context.symptoms),
    ...(options.includeRawContext ? { raw_context: nullableString(context.raw_context) } : {}),
  };
  return `${JSON.stringify({ incident, analysis }, null, 2)}\n`;
}

export function reportFilename(title: string | null | undefined, extension: "md" | "json"): string {
  let basename = Array.from((title ?? "").normalize("NFKC").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")).slice(0, 80).join("");
  if (!basename) basename = "incident-analysis";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename)) basename = `incident-${basename}`;
  return `${basename}.${extension === "json" ? "json" : "md"}`;
}
