import { useEffect, useRef, useState } from "react";
import type { InvestigationResult } from "@/lib/agent/types";
import type { Locale } from "@/lib/i18n/messages";
import type { InvestigationReportContext } from "@/lib/investigationReport";
import { buildInvestigationComparisonJson, buildInvestigationComparisonMarkdown } from "@/lib/investigationComparisonReport";

const LABELS = {
  en: {
    title: "Changes since the previous run",
    old: "Previous run", current: "Latest run", severity: "Severity", conclusion: "Conclusion", completion: "Completion", steps: "Steps", evidence: "Evidence records", calls: "Model calls", cost: "Cost",
    summary: "Diagnosis summary", hypotheses: "Root cause hypotheses", claims: "Evidence-backed claims", evidenceIds: "Evidence IDs",
    added: "Added", removed: "Removed", unchanged: "No changes", none: "None", complete: "Complete", incomplete: "Incomplete", unknown: "Unknown",
    copy: "Copy comparison", copying: "Copying…", markdown: "Download Markdown", json: "Download JSON", copied: "Comparison copied.", copyError: "Clipboard access failed.", downloaded: "Download started.", downloadError: "Could not create the download.",
    statuses: { supported: "Supported", tentative: "Tentative", insufficient_evidence: "Insufficient evidence" },
    note: "Runs may use different incident details or depth settings. A change shows what the investigator reported; it does not confirm that the incident changed.",
  },
  zh: {
    title: "与上次调查的变化",
    old: "上次调查", current: "本次调查", severity: "严重等级", conclusion: "诊断结论", completion: "完成状态", steps: "步骤", evidence: "证据记录", calls: "模型调用", cost: "费用",
    summary: "诊断摘要", hypotheses: "根因假设", claims: "有证据引用的结论", evidenceIds: "证据 ID",
    added: "新增", removed: "移除", unchanged: "没有变化", none: "无", complete: "已完成", incomplete: "未完成", unknown: "未知",
    copy: "复制对比报告", copying: "复制中…", markdown: "下载 Markdown", json: "下载 JSON", copied: "对比报告已复制。", copyError: "无法访问剪贴板。", downloaded: "下载已开始。", downloadError: "无法生成下载文件。",
    statuses: { supported: "有证据支持", tentative: "暂定", insufficient_evidence: "证据不足" },
    note: "两次调查可能使用了不同的故障信息或调查深度。差异仅表示调查器报告的变化，不能确认故障实际发生了变化。",
  },
} as const;

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function difference(before: string[], after: string[], caseSensitive = false) {
  const oldValues = unique(before), newValues = unique(after);
  const key = (value: string) => caseSensitive ? value : value.toLocaleLowerCase();
  const oldKeys = new Set(oldValues.map(key));
  const newKeys = new Set(newValues.map(key));
  return { added: newValues.filter(value => !oldKeys.has(key(value))), removed: oldValues.filter(value => !newKeys.has(key(value))) };
}

function ChangeList({ label, before, after, none, caseSensitive = false }: { label: string; before: string[]; after: string[]; none: string; caseSensitive?: boolean }) {
  const changes = difference(before, after, caseSensitive);
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</h3>
      {!changes.added.length && !changes.removed.length ? <p className="text-sm text-neutral-500">{none}</p> : <div className="space-y-2">
        {changes.added.length > 0 && <div><p className="mb-1 text-xs text-emerald-300">+ {changes.added.length}</p><ul className="list-disc space-y-1 pl-5 text-sm text-neutral-200">{changes.added.slice(0, 8).map((value, i) => <li key={`a-${i}`} className="break-words">{value}</li>)}</ul></div>}
        {changes.removed.length > 0 && <div><p className="mb-1 text-xs text-amber-300">− {changes.removed.length}</p><ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">{changes.removed.slice(0, 8).map((value, i) => <li key={`r-${i}`} className="break-words">{value}</li>)}</ul></div>}
      </div>}
    </section>
  );
}

export function InvestigationComparison({ previous, current, previousContext, currentContext, locale }: {
  previous: InvestigationResult;
  current: InvestigationResult;
  previousContext?: InvestigationReportContext;
  currentContext?: InvestigationReportContext;
  locale: Locale;
}) {
  const labels = LABELS[locale];
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "copyError" | "downloaded" | "downloadError">("idle");
  const generationRef = useRef(0);
  const previousRun = { result: previous, context: previousContext };
  const currentRun = { result: current, context: currentContext };
  useEffect(() => () => { generationRef.current += 1; }, []);
  const stats = [
    [labels.severity, previous.diagnosis.severity ?? labels.unknown, current.diagnosis.severity ?? labels.unknown],
    [labels.conclusion, labels.statuses[previous.diagnosis.conclusion_status], labels.statuses[current.diagnosis.conclusion_status]],
    [labels.completion, previous.completed ? labels.complete : labels.incomplete, current.completed ? labels.complete : labels.incomplete],
    [labels.steps, String(previous.steps), String(current.steps)],
    [labels.evidence, String(previous.evidence?.length ?? 0), String(current.evidence?.length ?? 0)],
    [labels.calls, String(previous.usage.model_calls), String(current.usage.model_calls)],
    [labels.cost, `$${previous.usage.cost_usd.toFixed(5)}`, `$${current.usage.cost_usd.toFixed(5)}`],
  ];
  const beforeHypotheses = previous.diagnosis.root_causes.map(item => item.hypothesis);
  const afterHypotheses = current.diagnosis.root_causes.map(item => item.hypothesis);
  const beforeClaims = previous.diagnosis.claims.map(item => item.text);
  const afterClaims = current.diagnosis.claims.map(item => item.text);
  const beforeEvidence = (previous.evidence ?? []).map(item => item.id);
  const afterEvidence = (current.evidence ?? []).map(item => item.id);

  async function copyComparison() {
    const generation = ++generationRef.current;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(buildInvestigationComparisonMarkdown(previousRun, currentRun, locale));
      if (generation === generationRef.current) setStatus("copied");
    } catch {
      if (generation === generationRef.current) setStatus("copyError");
    }
  }

  function downloadComparison(extension: "md" | "json") {
    let objectUrl: string | undefined;
    let link: HTMLAnchorElement | undefined;
    generationRef.current += 1;
    try {
      const content = extension === "md"
        ? buildInvestigationComparisonMarkdown(previousRun, currentRun, locale)
        : buildInvestigationComparisonJson(previousRun, currentRun, locale);
      objectUrl = URL.createObjectURL(new Blob([content], { type: extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }));
      link = document.createElement("a");
      link.href = objectUrl;
      link.download = `investigation-comparison.${extension}`;
      document.body.appendChild(link);
      link.click();
      setStatus("downloaded");
    } catch {
      setStatus("downloadError");
    } finally {
      link?.remove();
      if (objectUrl) {
        const url = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
  }

  return (
    <details className="overflow-hidden rounded-xl border border-indigo-500/30 bg-indigo-500/5">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-indigo-200 focus-visible:outline-2 focus-visible:outline-indigo-400">{labels.title}</summary>
      <div className="space-y-4 border-t border-indigo-500/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyComparison} disabled={status === "copying"} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-wait disabled:opacity-50">{status === "copying" ? labels.copying : labels.copy}</button>
          <button type="button" onClick={() => downloadComparison("md")} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">{labels.markdown}</button>
          <button type="button" onClick={() => downloadComparison("json")} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">{labels.json}</button>
          {status !== "idle" && status !== "copying" && <p role="status" aria-live="polite" className={`text-xs ${status === "copyError" || status === "downloadError" ? "text-amber-300" : "text-emerald-300"}`}>{labels[status]}</p>}
        </div>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-neutral-950/70 text-xs text-neutral-400"><tr><th className="p-2 font-medium"></th><th className="p-2 font-medium">{labels.old}</th><th className="p-2 font-medium">{labels.current}</th></tr></thead>
            <tbody>{stats.map(([label, before, after]) => <tr key={label} className="border-t border-neutral-800"><th scope="row" className="p-2 font-medium text-neutral-400">{label}</th><td className="p-2 text-neutral-200">{before}</td><td className="p-2 text-neutral-200">{after}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 md:col-span-2"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{labels.summary}</h3><div className="grid gap-3 md:grid-cols-2"><p className="whitespace-pre-wrap break-words text-sm text-neutral-300">{previous.diagnosis.summary}</p><p className="whitespace-pre-wrap break-words text-sm text-neutral-200">{current.diagnosis.summary}</p></div></section>
          <ChangeList label={labels.hypotheses} before={beforeHypotheses} after={afterHypotheses} none={labels.unchanged} />
          <ChangeList label={labels.claims} before={beforeClaims} after={afterClaims} none={labels.unchanged} />
          <div className="md:col-span-2"><ChangeList label={labels.evidenceIds} before={beforeEvidence} after={afterEvidence} none={labels.unchanged} caseSensitive /></div>
        </div>
        <p className="text-xs text-neutral-500">{labels.note}</p>
      </div>
    </details>
  );
}
