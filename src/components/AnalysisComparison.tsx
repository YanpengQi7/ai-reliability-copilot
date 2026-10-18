import ReactMarkdown from "react-markdown";
import {
  compareAnalysisSections,
  type AnalysisContent,
} from "@/lib/analysisReview";
import { t, type Locale } from "@/lib/i18n/messages";

type SectionDifference = ReturnType<typeof compareAnalysisSections>[number];

const LABELS = {
  en: {
    title: "Analysis comparison",
    before: "Baseline",
    after: "Selected analysis",
    prompt: "Prompt",
    output: "Output",
    changed: "Changed",
    unchanged: "Unchanged",
    none: "No content recorded.",
    noChanges: "All 9 sections are unchanged.",
    explanation: "Changed sections are expanded. Open any section to inspect both versions.",
    differentLanguages: "These analyses use different output languages. Translation may account for some differences.",
    unknownLanguage: "Unknown",
    likelihood: "Likelihood:",
    priority: "Priority:",
    owner: "Owner:",
  },
  zh: {
    title: "分析版本对比",
    before: "对比基准",
    after: "当前查看的分析",
    prompt: "Prompt",
    output: "输出语言",
    changed: "已变更",
    unchanged: "未变更",
    none: "未记录内容。",
    noChanges: "全部 9 个部分均未变更。",
    explanation: "已变更部分默认展开。展开任一部分即可查看两个版本。",
    differentLanguages: "两个分析版本的输出语言不同。部分差异可能来自翻译。",
    unknownLanguage: "未知",
    likelihood: "可能性：",
    priority: "优先级：",
    owner: "负责人：",
  },
};

function field(item: unknown, key: string): string {
  if (!item || typeof item !== "object") return "";
  const value = (item as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function VersionLabel({ analysis, locale }: { analysis: AnalysisContent; locale: Locale }) {
  const labels = LABELS[locale];
  const createdAt = analysis.created_at ? new Date(analysis.created_at) : null;
  const metadata = [
    analysis.model,
    analysis.prompt_version ? `${labels.prompt} ${analysis.prompt_version}` : null,
    analysis.output_language ? `${labels.output}: ${analysis.output_language}` : null,
    createdAt && !Number.isNaN(createdAt.getTime())
      ? `${createdAt.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC" })} UTC`
      : null,
  ].filter(Boolean);

  if (!metadata.length) return null;
  return <p className="mb-3 break-words text-xs text-neutral-500">{metadata.join(" · ")}</p>;
}

function SectionValue({ section, value, locale }: {
  section: SectionDifference["key"];
  value: SectionDifference["before"];
  locale: Locale;
}) {
  const labels = LABELS[locale];
  const tr = (key: string) => t(locale, key);

  if (typeof value === "string") {
    if (!value.trim()) return <p className="text-sm italic text-neutral-500">{labels.none}</p>;
    if (section === "postmortem_draft") {
      return (
        <div className="prose prose-invert prose-sm max-w-none break-words prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-li:text-neutral-300 prose-strong:text-neutral-100 prose-pre:overflow-x-auto">
          <ReactMarkdown>{value}</ReactMarkdown>
        </div>
      );
    }
    return <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">{value}</p>;
  }

  if (!value.length) return <p className="text-sm italic text-neutral-500">{labels.none}</p>;

  if (section === "root_causes") {
    return (
      <ul className="space-y-4">
        {value.map((item, index) => (
          <li key={index} className="border-l-2 border-indigo-500/40 pl-3 text-sm">
            <p className="whitespace-pre-wrap break-words font-medium text-neutral-200">{field(item, "hypothesis")}</p>
            {field(item, "likelihood") && <p className="mt-1 text-xs text-neutral-400">{labels.likelihood} {field(item, "likelihood")}</p>}
            {field(item, "evidence") && <p className="mt-2 whitespace-pre-wrap break-words text-neutral-400"><span className="font-medium text-neutral-300">{tr("section.evidence")}</span> {field(item, "evidence")}</p>}
          </li>
        ))}
      </ul>
    );
  }

  if (section === "investigation_checklist") {
    return (
      <ol className="space-y-4">
        {value.map((item, index) => (
          <li key={index} className="text-sm">
            <p className="whitespace-pre-wrap break-words font-medium text-neutral-200">{index + 1}. {field(item, "step")}</p>
            {field(item, "command") && <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300"><code>{field(item, "command")}</code></pre>}
            {field(item, "expected") && <p className="mt-2 whitespace-pre-wrap break-words text-neutral-400"><span className="font-medium text-neutral-300">{tr("section.expected")}</span> {field(item, "expected")}</p>}
          </li>
        ))}
      </ol>
    );
  }

  if (section === "mitigation_plan") {
    return (
      <ul className="space-y-4">
        {value.map((item, index) => (
          <li key={index} className="text-sm">
            <p className="whitespace-pre-wrap break-words font-medium text-neutral-200">{field(item, "action")}</p>
            {field(item, "risk") && <p className="mt-2 whitespace-pre-wrap break-words text-amber-300/90"><span className="font-medium">{tr("section.risk")}</span> {field(item, "risk")}</p>}
            {field(item, "rollback") && <p className="mt-2 whitespace-pre-wrap break-words text-neutral-400"><span className="font-medium text-neutral-300">{tr("section.rollback")}</span> {field(item, "rollback")}</p>}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-4">
      {value.map((item, index) => (
        <li key={index} className="text-sm">
          <p className="whitespace-pre-wrap break-words font-medium text-neutral-200">{field(item, "item")}</p>
          {field(item, "priority") && <p className="mt-1 text-xs text-neutral-400">{labels.priority} {field(item, "priority")}</p>}
          {field(item, "owner_role") && <p className="mt-1 whitespace-pre-wrap break-words text-neutral-400">{labels.owner} {field(item, "owner_role")}</p>}
        </li>
      ))}
    </ul>
  );
}

export function AnalysisComparison({ baseline, current, locale }: {
  baseline: AnalysisContent;
  current: AnalysisContent;
  locale: Locale;
}) {
  const labels = LABELS[locale];
  const sections = compareAnalysisSections(baseline, current);
  const changedCount = sections.filter((section) => section.changed).length;
  const differentLanguages = baseline.output_language !== current.output_language
    && Boolean(baseline.output_language || current.output_language);

  return (
    <section aria-label={labels.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
          {locale === "zh" ? `${changedCount} / ${sections.length} 个部分已变更` : `${changedCount} of ${sections.length} sections changed`}
        </span>
      </div>
      <p className="mt-2 text-sm text-neutral-400">{changedCount ? labels.explanation : labels.noChanges}</p>
      {differentLanguages && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
          {labels.differentLanguages} <span className="whitespace-nowrap">({baseline.output_language || labels.unknownLanguage} → {current.output_language || labels.unknownLanguage})</span>
        </p>
      )}
      <div className="mt-4 space-y-3">
        {sections.map((section) => (
          <details key={section.key} open={section.changed} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/30">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-400">
              <span>{t(locale, section.labelKey)}</span>
              <span className={`ml-3 rounded border px-2 py-0.5 text-xs font-normal ${section.changed ? "border-indigo-500/30 text-indigo-300" : "border-neutral-700 text-neutral-500"}`}>
                {section.changed ? labels.changed : labels.unchanged}
              </span>
            </summary>
            <div className="grid min-w-0 gap-4 border-t border-neutral-800 p-4 md:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">{labels.before}</h3>
                <VersionLabel analysis={baseline} locale={locale} />
                <SectionValue section={section.key} value={section.before} locale={locale} />
              </div>
              <div className="min-w-0 border-t border-neutral-800 pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">{labels.after}</h3>
                <VersionLabel analysis={current} locale={locale} />
                <SectionValue section={section.key} value={section.after} locale={locale} />
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
