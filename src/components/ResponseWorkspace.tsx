"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AnalysisContent, ReportContext } from "@/lib/analysisReview";
import {
  RESPONSE_LIMITS,
  buildResponseActions,
  buildResponseHandoffJson,
  buildResponseHandoffMarkdown,
  getActionProgress,
  sanitizeResponseProgress,
  summarizeResponseProgress,
  type ActionProgress,
  type ActionStatus,
  type ResponseAction,
  type ResponseProgress,
} from "@/lib/responseActions";
import {
  clearResponseWorkspace,
  readResponseWorkspace,
  responseWorkspaceStorageKey,
  writeResponseWorkspace,
  type ResponseWorkspaceStorage,
} from "@/lib/responseWorkspaceStorage";
import { useLocale } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/messages";

const LABELS = {
  en: {
    title: "Response workspace",
    body: "Track investigation checks, mitigation actions, and follow-ups for this analysis.",
    manual: "Progress is recorded manually. Marking an action done does not verify it or confirm incident recovery.",
    empty: "This analysis has no investigation checks, mitigation actions, or follow-ups to track.",
    total: "Total",
    completion: "Manual action completion",
    markedDone: "marked done",
    show: "Show actions",
    noMatch: "No actions match this filter.",
    filters: { all: "All", open: "Open", blocked: "Blocked", done: "Done" },
    categories: { investigation: "Investigation checks", mitigation: "Mitigation actions", follow_up: "Follow-ups" },
    statuses: { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" },
    untitled: "Untitled recommendation",
    source: "Source recommendation",
    command: "Investigation command",
    copyCommand: "Copy command",
    commandCopied: "Copied",
    commandCopyFailed: "Copy failed",
    expected: "Expected result",
    risk: "Risk",
    rollback: "Rollback",
    suggestedOwner: "Suggested owner role",
    priority: "Priority",
    notRecorded: "Not recorded",
    status: "Status",
    owner: "Assigned owner",
    ownerPlaceholder: "Person or team",
    outcome: "Observed outcome / notes",
    outcomePlaceholder: "Record observations, evidence, blockers, or handoff notes.",
    redaction: "Known credential formats are redacted when a field loses focus and before browser saving or export. Review your notes; detection is not exhaustive.",
    redacted: "Known credentials were detected. Saved and exported notes use redacted values.",
    remember: "Remember progress in this browser",
    localOnly: "If selected, progress is saved only in this browser. It is not shared with teammates or stored on the server.",
    sessionOnly: "This unsaved analysis has session-only progress. Export a handoff before leaving this page.",
    checking: "Checking for remembered progress…",
    restored: "Restored remembered progress for this analysis.",
    saved: "Progress is remembered in this browser.",
    forgotten: "Saved browser progress removed. Current progress stays in this session.",
    invalid: "Saved browser progress was invalid and was ignored. You can choose to remember the current progress instead.",
    unavailable: "Browser storage is unavailable. Current progress stays in this session.",
    writeFailed: "Could not save the latest edits. They remain session-only; an older saved copy may remain in this browser.",
    clearFailed: "Could not remove the saved copy. It may still be remembered in this browser; clear site storage to remove it.",
    removeSaved: "Remove saved progress",
    savingDisabled: "Browser saving is disabled for this session. Current progress remains session-only.",
    reset: "Reset progress",
    resetTitle: "Reset all manual progress?",
    resetBody: "This clears statuses, assigned owners, and observed outcomes for every action in this workspace.",
    confirmReset: "Reset all progress",
    cancelReset: "Keep progress",
    resetDone: "Manual progress reset.",
    handoff: "Response handoff",
    handoffBody: "Includes all actions, observed outcomes, blockers, and next steps. Raw context and symptoms fields are excluded.",
    copy: "Copy handoff",
    copying: "Copying…",
    markdown: "Download Markdown",
    json: "Download JSON",
    copied: "Handoff copied to clipboard.",
    copyError: "Clipboard access failed. Download the Markdown handoff instead.",
    downloaded: "Download started.",
    downloadError: "The download could not start. Try copying the handoff or downloading again.",
  },
  zh: {
    title: "故障响应工作区",
    body: "跟踪此分析的排查步骤、缓解行动和后续行动项。",
    manual: "进度由操作人员手动记录。将行动标记为完成，不代表已验证其效果或确认故障恢复。",
    empty: "此分析没有可跟踪的排查步骤、缓解行动或后续行动项。",
    total: "总计",
    completion: "手动记录的行动完成进度",
    markedDone: "项标记为完成",
    show: "筛选行动",
    noMatch: "没有符合此筛选条件的行动。",
    filters: { all: "全部", open: "未完成", blocked: "受阻", done: "已完成" },
    categories: { investigation: "排查步骤", mitigation: "缓解行动", follow_up: "后续行动项" },
    statuses: { todo: "待办", in_progress: "进行中", blocked: "受阻", done: "已完成" },
    untitled: "未命名建议",
    source: "原始建议",
    command: "排查命令",
    copyCommand: "复制命令",
    commandCopied: "已复制",
    commandCopyFailed: "复制失败",
    expected: "预期结果",
    risk: "风险",
    rollback: "回滚",
    suggestedOwner: "建议负责人角色",
    priority: "优先级",
    notRecorded: "未记录",
    status: "状态",
    owner: "实际负责人",
    ownerPlaceholder: "人员或团队",
    outcome: "观察结果 / 笔记",
    outcomePlaceholder: "记录观察结果、证据、阻塞原因或交接笔记。",
    redaction: "离开输入框时，以及浏览器保存或导出前，会脱敏已知格式的凭据。请检查笔记；检测无法覆盖所有凭据。",
    redacted: "检测到已知格式的凭据。保存和导出的笔记使用脱敏后的内容。",
    remember: "在此浏览器中记住进度",
    localOnly: "勾选后，进度仅保存在此浏览器中，不会共享给其他成员，也不会保存到服务器。",
    sessionOnly: "此未保存分析的进度仅保留在当前会话中。离开页面前请导出交接报告。",
    checking: "正在检查已记住的进度…",
    restored: "已恢复此分析在浏览器中保存的进度。",
    saved: "进度已在此浏览器中记住。",
    forgotten: "已删除浏览器中保存的进度。当前进度保留在本次会话中。",
    invalid: "浏览器中保存的进度无效，已忽略。可以选择记住当前进度。",
    unavailable: "浏览器存储不可用。当前进度保留在本次会话中。",
    writeFailed: "无法保存最新修改。最新修改仅保留在当前会话中；浏览器中可能仍有较早的保存副本。",
    clearFailed: "无法删除已保存的副本。此浏览器可能仍记着该副本；请清除此网站的存储以删除它。",
    removeSaved: "删除已保存的进度",
    savingDisabled: "本次会话已停用浏览器保存。当前进度仅保留在当前会话中。",
    reset: "重置进度",
    resetTitle: "重置全部手动记录的进度？",
    resetBody: "这将清空此工作区所有行动的状态、实际负责人和观察结果。",
    confirmReset: "重置全部进度",
    cancelReset: "保留进度",
    resetDone: "手动记录的进度已重置。",
    handoff: "故障响应交接",
    handoffBody: "包含全部行动、观察结果、阻塞项和下一步行动。不包含原始上下文和症状字段。",
    copy: "复制交接报告",
    copying: "复制中…",
    markdown: "下载 Markdown",
    json: "下载 JSON",
    copied: "交接报告已复制到剪贴板。",
    copyError: "无法访问剪贴板。请下载 Markdown 交接报告。",
    downloaded: "下载已开始。",
    downloadError: "无法开始下载。请尝试复制交接报告或重新下载。",
  },
};

const CATEGORIES = ["investigation", "mitigation", "follow_up"] as const;
const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
const FILTERS = ["all", "open", "blocked", "done"] as const;
type ActionFilter = typeof FILTERS[number];
type StorageWarning = "invalid" | "unavailable" | "writeFailed" | "clearFailed";
type StorageNotice = "restored" | "saved" | "forgotten" | "resetDone";
type ExportStatus = "idle" | "copying" | "copied" | "copyError" | "downloaded" | "downloadError";

type WorkspaceProps = {
  analysis: AnalysisContent;
  context: ReportContext;
  workspaceId: string;
  persistenceAvailable?: boolean;
  locale?: Locale;
};

const BUTTON_CLASS = "rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50";

function SourceField({ label, value, empty, amber = false }: { label: string; value: string; empty: string; amber?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-neutral-400">{label}</dt>
      <dd className={`mt-1 whitespace-pre-wrap break-words text-sm ${amber ? "text-amber-200" : "text-neutral-300"}`}>{value || empty}</dd>
    </div>
  );
}

function ActionCard({ action, progress, locale, disabled, manualNoteId, onChange, onBlur }: {
  action: ResponseAction;
  progress: ActionProgress;
  locale: Locale;
  disabled: boolean;
  manualNoteId: string;
  onChange: (patch: Partial<ActionProgress>) => void;
  onBlur: () => void;
}) {
  const labels = LABELS[locale];
  const id = useId();
  const [commandCopyStatus, setCommandCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <article aria-labelledby={`${id}-title`} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id={`${id}-title`} className="min-w-0 flex-1 break-words text-sm font-medium text-neutral-100">{action.title || labels.untitled}</h4>
        <span className={`rounded border px-2 py-0.5 text-xs ${progress.status === "blocked" ? "border-amber-500/30 text-amber-300" : progress.status === "done" ? "border-emerald-500/30 text-emerald-300" : "border-neutral-700 text-neutral-400"}`}>{labels.statuses[progress.status]}</span>
      </div>
      <p className="mt-3 text-xs font-medium text-neutral-500">{labels.source}</p>
      <dl className="mt-2 space-y-3">
        {action.category === "investigation" && (
          <>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-neutral-400">{labels.command}</dt>
              <dd className="mt-1">
                {action.command ? (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(action.command);
                            setCommandCopyStatus("copied");
                          } catch {
                            setCommandCopyStatus("failed");
                          }
                        }}
                        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 focus-visible:outline-2 focus-visible:outline-indigo-400"
                      >
                        {commandCopyStatus === "copied" ? labels.commandCopied : labels.copyCommand}
                      </button>
                      {commandCopyStatus === "failed" && <span role="status" className="text-xs text-amber-300">{labels.commandCopyFailed}</span>}
                    </div>
                    <pre tabIndex={0} aria-label={labels.command} className="max-h-48 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-300 focus-visible:outline-2 focus-visible:outline-indigo-400"><code>{action.command}</code></pre>
                  </>
                ) : <p className="text-sm text-neutral-500">{labels.notRecorded}</p>}
              </dd>
            </div>
            <SourceField label={labels.expected} value={action.expected} empty={labels.notRecorded} />
          </>
        )}
        {action.category === "mitigation" && (
          <>
            <SourceField label={labels.risk} value={action.risk} empty={labels.notRecorded} amber />
            <SourceField label={labels.rollback} value={action.rollback} empty={labels.notRecorded} />
          </>
        )}
        {action.category === "follow_up" && (
          <>
            <SourceField label={labels.suggestedOwner} value={action.suggestedOwner} empty={labels.notRecorded} />
            <SourceField label={labels.priority} value={action.priority} empty={labels.notRecorded} />
          </>
        )}
      </dl>

      <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-3 border-t border-neutral-800 pt-4 disabled:opacity-60">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label htmlFor={`${id}-status`} className="flex min-w-0 flex-col gap-1 text-xs text-neutral-400">
            <span>{labels.status}</span>
            <select id={`${id}-status`} value={progress.status} aria-describedby={manualNoteId} onChange={(event) => onChange({ status: event.target.value as ActionStatus })} className="min-w-0 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-indigo-400">
              {STATUSES.map((status) => <option key={status} value={status}>{labels.statuses[status]}</option>)}
            </select>
          </label>
          <label htmlFor={`${id}-owner`} className="flex min-w-0 flex-col gap-1 text-xs text-neutral-400">
            <span>{labels.owner}</span>
            <input id={`${id}-owner`} value={progress.owner} maxLength={RESPONSE_LIMITS.owner} placeholder={labels.ownerPlaceholder} onChange={(event) => onChange({ owner: event.target.value })} onBlur={onBlur} className="min-w-0 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-indigo-400" />
          </label>
        </div>
        <label htmlFor={`${id}-outcome`} className="flex min-w-0 flex-col gap-1 text-xs text-neutral-400">
          <span>{labels.outcome}</span>
          <textarea id={`${id}-outcome`} value={progress.outcome} rows={3} maxLength={RESPONSE_LIMITS.outcome} placeholder={labels.outcomePlaceholder} aria-describedby={`${id}-outcome-count`} onChange={(event) => onChange({ outcome: event.target.value })} onBlur={onBlur} className="w-full min-w-0 resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-indigo-400" />
          <span id={`${id}-outcome-count`} className="text-right text-neutral-500">{progress.outcome.length.toLocaleString(locale)} / {RESPONSE_LIMITS.outcome.toLocaleString(locale)}</span>
        </label>
      </fieldset>
    </article>
  );
}

export function ResponseWorkspace({ analysis, context, workspaceId, persistenceAvailable = false, locale: selectedLocale }: WorkspaceProps) {
  const activeLocale = useLocale();
  const locale = selectedLocale ?? activeLocale;
  const actions = useMemo(() => buildResponseActions(analysis), [analysis]);
  if (!actions.length) {
    return (
      <section aria-label={LABELS[locale].title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">{LABELS[locale].title}</h2>
        <p className="mt-2 text-sm text-neutral-400">{LABELS[locale].empty}</p>
      </section>
    );
  }
  // Each source identity gets its own state and storage lifecycle, even when callers reuse this component.
  return <WorkspaceSession key={`${workspaceId}:${persistenceAvailable ? "saved" : "session"}`} analysis={analysis} context={context} workspaceId={workspaceId} actions={actions} persistenceAvailable={persistenceAvailable} locale={locale} />;
}

function WorkspaceSession({ analysis, context, workspaceId, actions, persistenceAvailable, locale }: {
  analysis: AnalysisContent;
  context: ReportContext;
  workspaceId: string;
  actions: ResponseAction[];
  persistenceAvailable: boolean;
  locale: Locale;
}) {
  const labels = LABELS[locale];
  const id = useId();
  const [progress, setProgress] = useState<ResponseProgress>({});
  const progressRef = useRef<ResponseProgress>({});
  const [filter, setFilter] = useState<ActionFilter>("all");
  const [remember, setRemember] = useState(false);
  const rememberRef = useRef(false);
  const [ready, setReady] = useState(!persistenceAvailable);
  const initializedRef = useRef(false);
  const storageRef = useRef<ResponseWorkspaceStorage | null>(null);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [storageWarning, setStorageWarning] = useState<StorageWarning | null>(null);
  const [storageNotice, setStorageNotice] = useState<StorageNotice | null>(null);
  const [hasRedactions, setHasRedactions] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const exportGenerationRef = useRef(0);

  useEffect(() => {
    if (initializedRef.current || !persistenceAvailable) return;
    initializedRef.current = true;
    // Browser storage is an external system. Restore after hydration, before enabling edits; this effect never writes.
    /* eslint-disable react-hooks/set-state-in-effect -- Browser-only restoration cannot run during server rendering. */
    try {
      const storage = window.localStorage;
      storageRef.current = storage;
      const restored = readResponseWorkspace(storage, workspaceId, actions);
      if (restored.kind === "restored") {
        progressRef.current = restored.progress;
        setProgress(restored.progress);
        rememberRef.current = true;
        setRemember(true);
        setStorageNotice("restored");
      } else if (restored.kind === "invalid") {
        setStorageWarning("invalid");
      } else if (restored.kind === "unavailable") {
        setStorageWarning("unavailable");
        setPersistenceFailed(true);
      }
    } catch {
      setStorageWarning("unavailable");
      setPersistenceFailed(true);
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [actions, persistenceAvailable, workspaceId]);

  useEffect(() => () => {
    exportGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (!persistenceAvailable) return;
    const storageKey = responseWorkspaceStorageKey(workspaceId);
    function handleStorageRemoval(event: StorageEvent) {
      if (event.key !== null && (event.key !== storageKey || event.newValue !== null)) return;
      if (event.storageArea && event.storageArea !== storageRef.current) return;
      // Revocation in another tab keeps this tab's notes but prevents its next edit from recreating the saved copy.
      rememberRef.current = false;
      setRemember(false);
      setStorageWarning(null);
      setStorageNotice("forgotten");
    }
    window.addEventListener("storage", handleStorageRemoval);
    return () => window.removeEventListener("storage", handleStorageRemoval);
  }, [persistenceAvailable, workspaceId]);

  function cleanedProgress(current: ResponseProgress): ResponseProgress {
    const clean = sanitizeResponseProgress(actions, current);
    if (actions.some((action) => {
      const before = getActionProgress(current, action.id);
      const after = getActionProgress(clean, action.id);
      return before.owner !== after.owner || before.outcome !== after.outcome;
    })) setHasRedactions(true);
    return clean;
  }

  function storageFailed(warning: "writeFailed" | "clearFailed") {
    rememberRef.current = false;
    setRemember(false);
    setPersistenceFailed(true);
    setStorageWarning(warning);
    setStorageNotice(null);
  }

  function persistIfRemembered(current: ResponseProgress) {
    if (!rememberRef.current || !storageRef.current) return;
    const safe = cleanedProgress(current);
    if (!writeResponseWorkspace(storageRef.current, workspaceId, actions, safe)) {
      storageFailed("writeFailed");
    } else {
      setStorageNotice("saved");
    }
  }

  function commitProgress(next: ResponseProgress, cleanDisplay = false) {
    const current = cleanDisplay ? cleanedProgress(next) : next;
    progressRef.current = current;
    setProgress(current);
    setResetRequested(false);
    exportGenerationRef.current += 1;
    setExportStatus("idle");
    persistIfRemembered(current);
  }

  function updateAction(actionId: string, patch: Partial<ActionProgress>) {
    commitProgress({ ...progressRef.current, [actionId]: { ...getActionProgress(progressRef.current, actionId), ...patch } });
  }

  function toggleRemember(enabled: boolean) {
    if (!enabled) {
      forgetSavedProgress();
      return;
    }
    if (!ready || persistenceFailed || !storageRef.current) return;
    const safe = cleanedProgress(progressRef.current);
    if (!writeResponseWorkspace(storageRef.current, workspaceId, actions, safe)) {
      storageFailed("writeFailed");
      return;
    }
    rememberRef.current = true;
    setRemember(true);
    setStorageWarning(null);
    setStorageNotice("saved");
  }

  function forgetSavedProgress() {
    if (!ready || !storageRef.current) return;
    rememberRef.current = false;
    setRemember(false);
    if (!clearResponseWorkspace(storageRef.current, workspaceId)) {
      storageFailed("clearFailed");
    } else {
      setStorageWarning(null);
      setStorageNotice("forgotten");
    }
  }

  function resetProgress() {
    commitProgress({});
    setFilter("all");
    setStorageNotice("resetDone");
  }

  function prepareHandoff(): ResponseProgress {
    const safe = cleanedProgress(progressRef.current);
    commitProgress(safe);
    return safe;
  }

  async function copyHandoff() {
    const safe = prepareHandoff();
    const generation = ++exportGenerationRef.current;
    setExportStatus("copying");
    try {
      await navigator.clipboard.writeText(buildResponseHandoffMarkdown(analysis, context, safe, { locale }));
      if (generation === exportGenerationRef.current) setExportStatus("copied");
    } catch {
      if (generation === exportGenerationRef.current) setExportStatus("copyError");
    }
  }

  function downloadHandoff(extension: "md" | "json") {
    let objectUrl: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const safe = prepareHandoff();
      const content = extension === "md"
        ? buildResponseHandoffMarkdown(analysis, context, safe, { locale })
        : buildResponseHandoffJson(analysis, context, safe, { locale });
      objectUrl = URL.createObjectURL(new Blob([content], { type: extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }));
      link = document.createElement("a");
      link.href = objectUrl;
      link.download = `incident-response-handoff.${extension}`;
      document.body.appendChild(link);
      link.click();
      setExportStatus("downloaded");
    } catch {
      setExportStatus("downloadError");
    } finally {
      link?.remove();
      if (objectUrl) {
        const url = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
  }

  const counts = summarizeResponseProgress(actions, progress);
  const filterCounts = { all: counts.total, open: counts.total - counts.done, blocked: counts.blocked, done: counts.done };
  const visible = actions.filter((action) => {
    const status = getActionProgress(progress, action.id).status;
    return filter === "all" || (filter === "open" ? status !== "done" : status === filter);
  });
  const exportMessage = exportStatus === "idle" || exportStatus === "copying" ? "" : labels[exportStatus];
  const exportFailed = exportStatus === "copyError" || exportStatus === "downloadError";

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-xl border border-indigo-500/20 bg-neutral-900 p-4 md:p-5">
      <h2 id={`${id}-title`} className="text-lg font-semibold">{labels.title}</h2>
      <p className="mt-2 text-sm text-neutral-400">{labels.body}</p>
      <p id={`${id}-manual`} className="mt-2 text-xs text-neutral-500">{labels.manual}</p>

      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/30 p-3">
        <p className="text-sm font-medium text-neutral-200">{counts.done} / {counts.total} {labels.markedDone}</p>
        <progress max={counts.total} value={counts.done} aria-label={labels.completion} className="mt-2 h-2 w-full accent-indigo-400" />
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-400">
          {STATUSES.map((status) => <div key={status} className="flex items-center gap-1"><dt>{labels.statuses[status]}:</dt><dd className={status === "blocked" && counts.blocked ? "font-medium text-amber-300" : "text-neutral-200"}>{counts[status]}</dd></div>)}
        </dl>
      </div>

      <div className="mt-4 space-y-2">
        {persistenceAvailable ? (
          <>
            <label htmlFor={`${id}-remember`} className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
              <input id={`${id}-remember`} type="checkbox" checked={remember} disabled={!ready || persistenceFailed} onChange={(event) => toggleRemember(event.target.checked)} className="mt-1 h-4 w-4 accent-indigo-500 disabled:cursor-not-allowed" />
              <span>{labels.remember}</span>
            </label>
            <p className="pl-6 text-xs text-neutral-500">{labels.localOnly}</p>
          </>
        ) : <p className="text-xs text-neutral-400">{labels.sessionOnly}</p>}
        {!ready && <p role="status" className="text-xs text-neutral-400">{labels.checking}</p>}
        {storageWarning && <p role="alert" className="text-xs text-amber-300">{labels[storageWarning]}</p>}
        {persistenceFailed && !storageWarning && <p className="text-xs text-neutral-500">{labels.savingDisabled}</p>}
        {persistenceAvailable && ready && (storageWarning === "writeFailed" || storageWarning === "clearFailed") && <button type="button" onClick={forgetSavedProgress} className={BUTTON_CLASS}>{labels.removeSaved}</button>}
        {storageNotice && <p role="status" aria-live="polite" className="text-xs text-neutral-400">{labels[storageNotice]}</p>}
      </div>

      <p className="mt-3 text-xs text-neutral-500">{labels.redaction}</p>
      {hasRedactions && <p role="status" className="mt-2 text-xs text-amber-300">{labels.redacted}</p>}

      <fieldset className="mt-4" aria-label={labels.show}>
        <legend className="mb-2 text-xs text-neutral-400">{labels.show}</legend>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`${BUTTON_CLASS} ${filter === value ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200" : ""}`}>{labels.filters[value]} ({filterCounts[value]})</button>)}
        </div>
      </fieldset>

      <div className="mt-4 space-y-5">
        {CATEGORIES.map((category) => {
          const group = visible.filter((action) => action.category === category);
          if (!group.length) return null;
          return (
            <section key={category} aria-labelledby={`${id}-${category}`} className="min-w-0">
              <h3 id={`${id}-${category}`} className="mb-3 text-sm font-semibold text-neutral-200">{labels.categories[category]}</h3>
              <div className="min-w-0 space-y-3">
                {group.map((action) => <ActionCard key={action.id} action={action} progress={getActionProgress(progress, action.id)} locale={locale} disabled={!ready} manualNoteId={`${id}-manual`} onChange={(patch) => updateAction(action.id, patch)} onBlur={() => commitProgress(progressRef.current, true)} />)}
              </div>
            </section>
          );
        })}
        {!visible.length && <p className="rounded-lg border border-neutral-800 p-4 text-sm text-neutral-400">{labels.noMatch}</p>}
      </div>

      <div className="mt-4">
        {!resetRequested
          ? <button type="button" disabled={!ready || !Object.keys(progress).length} onClick={() => setResetRequested(true)} className={BUTTON_CLASS}>{labels.reset}</button>
          : <div role="group" aria-labelledby={`${id}-reset`} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <h3 id={`${id}-reset`} className="text-sm font-medium text-amber-200">{labels.resetTitle}</h3>
            <p className="mt-2 text-xs text-neutral-400">{labels.resetBody}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={resetProgress} className={`${BUTTON_CLASS} border-amber-500/40 text-amber-200`}>{labels.confirmReset}</button>
              <button type="button" onClick={() => setResetRequested(false)} className={BUTTON_CLASS}>{labels.cancelReset}</button>
            </div>
          </div>}
      </div>

      <section aria-labelledby={`${id}-handoff`} className="mt-5 border-t border-neutral-800 pt-4">
        <h3 id={`${id}-handoff`} className="text-sm font-semibold text-neutral-200">{labels.handoff}</h3>
        <p className="mt-2 text-xs text-neutral-500">{labels.handoffBody}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={!ready || exportStatus === "copying"} onClick={copyHandoff} className={BUTTON_CLASS}>{exportStatus === "copying" ? labels.copying : labels.copy}</button>
          <button type="button" disabled={!ready} onClick={() => downloadHandoff("md")} className={BUTTON_CLASS}>{labels.markdown}</button>
          <button type="button" disabled={!ready} onClick={() => downloadHandoff("json")} className={BUTTON_CLASS}>{labels.json}</button>
        </div>
        <p role="status" aria-live="polite" className={`mt-2 min-h-4 text-xs ${exportFailed ? "text-amber-300" : "text-emerald-300"}`}>{exportMessage}</p>
      </section>
    </section>
  );
}
