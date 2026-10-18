"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { InvestigationResult } from "@/lib/agent/types";
import { buildInvestigationJson, buildInvestigationMarkdown, type InvestigationReportContext } from "@/lib/investigationReport";
import { useLocale } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/messages";

const LABELS = {
  en: {
    title: "Export investigation", incomplete: "Incomplete investigation", unknownSeverity: "Unknown severity",
    incompleteHint: "The investigation stopped with unresolved work. Its completion state and stop reason are included in the report.",
    copy: "Copy report", copying: "Copying…", markdown: "Download Markdown", json: "Download JSON",
    includeRaw: "Include evidence text and tool inputs/observations",
    privacy: "Default reports omit evidence bodies, tool inputs and observations, and planner queries. Narrative fields may still quote evidence. Including raw details also includes planner queries.",
    redaction: "Known credential formats are redacted in exports. Review the report before sharing; detection is not exhaustive.",
    hash: "Source hashes describe the original supplied payload. Exported text may be transformed or redacted; these hashes do not verify the exported body.",
    copied: "Investigation report copied to clipboard.", copyError: "Clipboard access failed. Download the Markdown report instead.", downloaded: "Download started.", downloadError: "The download could not start. Try copying the report or downloading again.",
  },
  zh: {
    title: "导出调查报告", incomplete: "调查未完成", unknownSeverity: "严重等级未知",
    incompleteHint: "调查结束时仍有待完成的工作。报告中包含完成状态与停止原因。",
    copy: "复制报告", copying: "复制中…", markdown: "下载 Markdown", json: "下载 JSON",
    includeRaw: "包含证据文本及工具输入 / 观察记录",
    privacy: "默认报告不包含证据正文、工具输入和观察记录，以及规划器查询。叙述字段仍可能引用证据。包含原始详情时也会包含规划器查询。",
    redaction: "导出时会脱敏已知格式的凭据。共享前请检查报告；检测无法覆盖所有凭据。",
    hash: "来源哈希描述原始提供的内容。导出文本可能经过转换或脱敏；这些哈希并不能验证导出后的正文。",
    copied: "调查报告已复制到剪贴板。", copyError: "无法访问剪贴板。请下载 Markdown 报告。", downloaded: "下载已开始。", downloadError: "无法开始下载。请尝试复制报告或重新下载。",
  },
};

type ExportStatus = "idle" | "copying" | "copied" | "copyError" | "downloaded" | "downloadError";

export function InvestigationExport({ result, context, locale: selectedLocale }: {
  result: InvestigationResult; context: InvestigationReportContext; locale?: Locale;
}) {
  const activeLocale = useLocale();
  const locale = selectedLocale ?? activeLocale;
  const labels = LABELS[locale];
  const id = useId();
  const [includeRawEvidence, setIncludeRawEvidence] = useState(false);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const generationRef = useRef(0);
  const options = { locale, includeRawEvidence };
  const buttonClass = "rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-wait disabled:opacity-50";

  useEffect(() => () => { generationRef.current += 1; }, []);

  async function copyReport() {
    const generation = ++generationRef.current;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(buildInvestigationMarkdown(result, context, options));
      if (generation === generationRef.current) setStatus("copied");
    } catch {
      if (generation === generationRef.current) setStatus("copyError");
    }
  }

  function downloadReport(extension: "md" | "json") {
    let objectUrl: string | undefined;
    let link: HTMLAnchorElement | undefined;
    generationRef.current += 1;
    try {
      const content = extension === "md" ? buildInvestigationMarkdown(result, context, options) : buildInvestigationJson(result, context, options);
      objectUrl = URL.createObjectURL(new Blob([content], { type: extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }));
      link = document.createElement("a");
      link.href = objectUrl;
      link.download = `investigation-report.${extension}`;
      document.body.appendChild(link);
      link.click();
      setStatus("downloaded");
    } catch {
      setStatus("downloadError");
    } finally {
      link?.remove();
      if (objectUrl) { const url = objectUrl; window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
  }

  const failed = status === "copyError" || status === "downloadError";
  const statusText = status === "idle" || status === "copying" ? "" : labels[status];

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`${id}-title`} className="text-lg font-semibold">{labels.title}</h2>
          {result.completed === false && <span className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-200">{labels.incomplete}</span>}
          {result.diagnosis.severity === null && <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400">{labels.unknownSeverity}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={status === "copying"} onClick={copyReport} className={buttonClass}>{status === "copying" ? labels.copying : labels.copy}</button>
          <button type="button" onClick={() => downloadReport("md")} className={buttonClass}>{labels.markdown}</button>
          <button type="button" onClick={() => downloadReport("json")} className={buttonClass}>{labels.json}</button>
        </div>
      </div>
      {result.completed === false && <p className="mt-3 text-xs text-amber-200">{labels.incompleteHint}</p>}
      <label htmlFor={`${id}-raw`} className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
        <input id={`${id}-raw`} type="checkbox" checked={includeRawEvidence} aria-describedby={`${id}-privacy`} onChange={(event) => { generationRef.current += 1; setIncludeRawEvidence(event.target.checked); setStatus("idle"); }} className="mt-1 h-4 w-4 accent-indigo-500" />
        <span>{labels.includeRaw}</span>
      </label>
      <p id={`${id}-privacy`} className="mt-2 text-xs text-neutral-500">{labels.privacy}</p>
      <p className="mt-2 text-xs text-neutral-500">{labels.redaction}</p>
      <p className="mt-2 text-xs text-neutral-500">{labels.hash}</p>
      <p role="status" aria-live="polite" className={`mt-2 min-h-4 text-xs ${failed ? "text-amber-300" : "text-emerald-300"}`}>{statusText}</p>
    </section>
  );
}
