"use client";

import { useId, useState } from "react";
import {
  buildAnalysisJson,
  buildAnalysisMarkdown,
  reportFilename,
  type AnalysisContent,
  type ReportContext,
} from "@/lib/analysisReview";
import { useLocale } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/messages";

const LABELS = {
  en: {
    title: "Export analysis",
    copy: "Copy report",
    copying: "Copying…",
    markdown: "Download Markdown",
    json: "Download JSON",
    includeContext: "Include raw incident context",
    contextHint: "The raw context section is excluded by default.",
    copied: "Report copied to clipboard.",
    copyError: "Clipboard access failed. Download the Markdown report instead.",
    downloaded: "Download started.",
    downloadError: "The download could not start. Try copying the report or downloading again.",
  },
  zh: {
    title: "导出分析",
    copy: "复制报告",
    copying: "复制中…",
    markdown: "下载 Markdown",
    json: "下载 JSON",
    includeContext: "包含原始故障上下文",
    contextHint: "默认不包含原始故障上下文部分。",
    copied: "报告已复制到剪贴板。",
    copyError: "无法访问剪贴板。请下载 Markdown 报告。",
    downloaded: "下载已开始。",
    downloadError: "无法开始下载。请尝试复制报告或重新下载。",
  },
};

type ExportStatus = "idle" | "copying" | "copied" | "copyError" | "downloaded" | "downloadError";

export function AnalysisExport({ analysis, context, locale: selectedLocale }: {
  analysis: AnalysisContent;
  context: ReportContext;
  locale?: Locale;
}) {
  const activeLocale = useLocale();
  const locale = selectedLocale ?? activeLocale;
  const labels = LABELS[locale];
  const checkboxId = useId();
  const [includeRawContext, setIncludeRawContext] = useState(false);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const hasRawContext = typeof context.raw_context === "string" && context.raw_context.length > 0;
  const options = { includeRawContext: hasRawContext && includeRawContext, locale };
  const buttonClass = "rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-wait disabled:opacity-50";

  async function copyReport() {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(buildAnalysisMarkdown(analysis, context, options));
      setStatus("copied");
    } catch {
      setStatus("copyError");
    }
  }

  function downloadReport(extension: "md" | "json") {
    let objectUrl: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const content = extension === "md"
        ? buildAnalysisMarkdown(analysis, context, options)
        : buildAnalysisJson(analysis, context, options);
      const mimeType = extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
      objectUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
      link = document.createElement("a");
      link.href = objectUrl;
      link.download = reportFilename(context.title || context.service, extension);
      document.body.appendChild(link);
      link.click();
      setStatus("downloaded");
    } catch {
      setStatus("downloadError");
    } finally {
      link?.remove();
      if (objectUrl) {
        const url = objectUrl;
        // Give the browser time to begin the download before releasing its URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
  }

  const statusText = status === "idle" || status === "copying" ? "" : labels[status];
  const failed = status === "copyError" || status === "downloadError";

  return (
    <section aria-label={labels.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-200">{labels.title}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyReport} disabled={status === "copying"} className={buttonClass}>
            {status === "copying" ? labels.copying : labels.copy}
          </button>
          <button type="button" onClick={() => downloadReport("md")} className={buttonClass}>{labels.markdown}</button>
          <button type="button" onClick={() => downloadReport("json")} className={buttonClass}>{labels.json}</button>
        </div>
      </div>
      {hasRawContext && (
        <div className="mt-3">
          <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
            <input
              id={checkboxId}
              type="checkbox"
              checked={includeRawContext}
              onChange={(event) => {
                setIncludeRawContext(event.target.checked);
                setStatus("idle");
              }}
              className="mt-1 h-4 w-4 accent-indigo-500"
            />
            <span>{labels.includeContext}</span>
          </label>
          <p className="mt-1 pl-6 text-xs text-neutral-500">{labels.contextHint}</p>
        </div>
      )}
      <p role="status" aria-live="polite" className={`mt-2 min-h-4 text-xs ${failed ? "text-amber-300" : "text-emerald-300"}`}>
        {statusText}
      </p>
    </section>
  );
}
