"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useState, type Ref } from "react";
import type { Decision, Diagnosis } from "@/lib/agent/diagnosis";
import type { EvidenceItem } from "@/lib/agent/evidence";
import type { TraceStep } from "@/lib/agent/types";
import { DEFAULT_EVIDENCE_FILTER, EVIDENCE_KINDS, buildInvestigationEvidenceIndex, filterInvestigationEvidence, type EvidenceFilter } from "@/lib/investigationEvidence";
import { useLocale } from "@/lib/i18n/client";

export type InvestigationReviewHandle = { revealEvidence(id: string): boolean };

const LABELS = {
  en: {
    decisions: "Investigation decisions", decisionHint: "Review the planner’s reasons and cited evidence. Hypotheses still need verification.",
    stopped: "Planner stopped gathering evidence", check: "Check:", noReason: "No reason recorded.", query: "Query:", result: "Read result:", noDecisions: "No planner decisions recorded.",
    supports: "Supporting citations:", contradicts: "Contradicting citations:", needed: "Needed:", noneCited: "None cited", inspectReference: "Inspect evidence", unavailable: "unavailable", ambiguous: "ambiguous ID",
    unresolved: "Unresolved evidence", noMissing: "No missing evidence stated in the diagnosis.", nextChecks: "Root cause hypotheses and next checks", nextCheck: "Next check:",
    evidence: "Evidence workspace", sourceHint: "Source metadata is supplied by the evidence adapter. User and alert reports are unverified context.",
    search: "Search evidence", searchPlaceholder: "ID, source, service, text, or measurement", searchHint: "Literal text search, ignoring case. Filters stay in this page and do not change exported reports.",
    kind: "Evidence kind", allKinds: "All kinds",
    kinds: { user_context: "Reported context", metric: "Metric", log: "Log", deploy: "Deployment", runbook: "Runbook", tool_observation: "Tool observation", unknown: "Unknown kind" },
    service: "Service (exact name)", allServices: "All services", serviceHint: "Service names match exactly, including case and spaces.",
    usage: "Citation use", allUsage: "All records", cited: "Cited records", uncited: "Uncited records", clear: "Clear filters", shown: "records shown",
    noEvidence: "No evidence records were returned for this investigation.", noMatches: "No evidence records match these filters.",
    audit: "Reference audit", auditHint: "These reference IDs need review. A citation alone does not establish factual support.", missingIds: "Referenced IDs without a record:", ambiguousIds: "IDs with conflicting records:", review: "Needs review",
    inspect: "Inspect", hide: "Hide", unverified: "Unverified reported context", source: "Source", observed: "Observed at", available: "Available at", measurement: "Measurement", window: "Window",
    sourceHash: "Original source content hash", hashHint: "The source supplies this original content hash. Displayed text may be transformed or redacted; this view does not verify the original payload.", body: "Evidence text", notRecorded: "Not recorded",
    readStatuses: { ok: "Completed", refused: "Refused", error: "Error", empty: "No observations" },
  },
  zh: {
    decisions: "调查决策", decisionHint: "检查规划器的理由及其引用的证据。根因假设仍需验证。",
    stopped: "规划器已停止收集证据", check: "检查：", noReason: "未记录理由。", query: "查询：", result: "读取结果：", noDecisions: "未记录规划器决策。",
    supports: "支持该假设的引用：", contradicts: "反驳该假设的引用：", needed: "所需信息：", noneCited: "无引用", inspectReference: "查看证据", unavailable: "不可用", ambiguous: "ID 存在歧义",
    unresolved: "待补充的证据", noMissing: "诊断中未说明缺失的证据。", nextChecks: "根因假设与下一步检查", nextCheck: "下一步检查：",
    evidence: "证据工作区", sourceHint: "来源元数据由证据适配器提供。用户与告警报告属于未独立验证的上下文。",
    search: "搜索证据", searchPlaceholder: "ID、来源、服务、文本或测量值", searchHint: "搜索输入的原文，不区分大小写。筛选仅作用于本页，不会改变导出的报告。",
    kind: "证据类型", allKinds: "全部类型",
    kinds: { user_context: "报告上下文", metric: "指标", log: "日志", deploy: "部署", runbook: "运行手册", tool_observation: "工具观察记录", unknown: "未知类型" },
    service: "服务（完整名称）", allServices: "全部服务", serviceHint: "服务名称精确匹配，包括大小写和空格。",
    usage: "引用情况", allUsage: "全部记录", cited: "已引用记录", uncited: "未引用记录", clear: "清除筛选", shown: "条记录显示",
    noEvidence: "此次调查未返回证据记录。", noMatches: "没有符合筛选条件的证据记录。",
    audit: "引用检查", auditHint: "这些引用 ID 需要检查。引用本身不能证明事实受到证据支持。", missingIds: "被引用但没有对应记录的 ID：", ambiguousIds: "对应冲突记录的 ID：", review: "需要检查",
    inspect: "查看", hide: "收起", unverified: "未独立验证的报告上下文", source: "来源", observed: "观测时间", available: "可用时间", measurement: "测量值", window: "时间窗口",
    sourceHash: "原始来源内容哈希", hashHint: "此原始内容哈希由来源提供。显示的文本可能经过转换或脱敏；此视图并未验证原始内容。", body: "证据文本", notRecorded: "未记录",
    readStatuses: { ok: "读取完成", refused: "已拒绝", error: "错误", empty: "无观察记录" },
  },
};

const INPUT_CLASS = "min-w-0 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-2 focus-visible:outline-indigo-400";
const BUTTON_CLASS = "rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";

export function InvestigationReview({ decisions, evidence, trace, diagnosis, ref }: {
  decisions: Decision[]; evidence: EvidenceItem[]; trace: TraceStep[]; diagnosis: Diagnosis; ref?: Ref<InvestigationReviewHandle>;
}) {
  const locale = useLocale();
  const labels = LABELS[locale];
  const instanceId = useId();
  const index = useMemo(() => buildInvestigationEvidenceIndex({ evidence, diagnosis, decisions, trace }), [evidence, diagnosis, decisions, trace]);
  const [filters, setFilters] = useState<EvidenceFilter>({ ...DEFAULT_EVIDENCE_FILTER });
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ recordKey: string; nonce: number } | null>(null);
  const visible = useMemo(() => filterInvestigationEvidence(index, filters), [index, filters]);
  const services = useMemo(() => [...new Set(index.evidence.map((item) => item.service).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale)), [index, locale]);

  const revealEvidence = useCallback((evidenceId: string): boolean => {
    if (index.ambiguousIds.includes(evidenceId)) return false;
    const records = index.evidence.filter((item) => item.id === evidenceId);
    if (records.length !== 1) return false;
    const target = records[0];
    const next = { ...filters };
    if (filters.query && !filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, query: filters.query }).some((item) => item.recordKey === target.recordKey)) next.query = "";
    if (filters.kind !== "all" && filters.kind !== target.kind) next.kind = "all";
    if (filters.service && filters.service !== target.service) next.service = "";
    const cited = index.citedIds.includes(evidenceId);
    if ((filters.usage === "cited" && !cited) || (filters.usage === "uncited" && cited)) next.usage = "all";
    setFilters(next);
    setSelectedRecord(target.recordKey);
    setFocusRequest((current) => ({ recordKey: target.recordKey, nonce: (current?.nonce ?? 0) + 1 }));
    return true;
  }, [filters, index]);

  useImperativeHandle(ref, () => ({ revealEvidence }), [revealEvidence]);

  useEffect(() => {
    if (!focusRequest) return;
    const target = document.getElementById(`${instanceId}-${focusRequest.recordKey}-toggle`);
    if (!target) return;
    target.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [focusRequest, instanceId]);

  function citations(ids: string[]) {
    if (!ids.length) return <span className="text-xs text-neutral-500">{labels.noneCited}</span>;
    return <span className="inline-flex max-w-full flex-wrap gap-2">
      {[...new Set(ids)].map((id) => {
        const ambiguous = index.ambiguousIds.includes(id);
        const available = !ambiguous && index.evidence.filter((item) => item.id === id).length === 1;
        return available
          ? <button key={id} type="button" onClick={() => revealEvidence(id)} aria-label={`${labels.inspectReference} ${id}`} className="max-w-full break-all rounded font-mono text-xs text-indigo-300 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">{id}</button>
          : <span key={id} className="max-w-full break-all font-mono text-xs text-amber-300">{id} ({ambiguous ? labels.ambiguous : labels.unavailable})</span>;
      })}
    </span>;
  }

  const missing = [...new Set([...diagnosis.missing_information, ...diagnosis.root_causes.flatMap((cause) => cause.missing_evidence)].filter((item) => item.trim()))];

  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby={`${instanceId}-decisions`} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 id={`${instanceId}-decisions`} className="mb-3 text-lg font-semibold text-white">{labels.decisions}</h2>
        <p className="mb-4 text-sm text-neutral-400">{labels.decisionHint}</p>
        <ol className="space-y-3">
          {decisions.map((decision, decisionIndex) => {
            const read = decision.done ? null : trace[decisionIndex];
            return <li key={decisionIndex} className="min-w-0 rounded-lg border border-neutral-800 p-3">
              <h3 className="break-words text-sm font-medium text-neutral-200">{decisionIndex + 1}. {decision.done ? labels.stopped : `${labels.check} ${decision.tool}`}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-400">{decision.reason || labels.noReason}</p>
              {!decision.done && decision.query && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-neutral-500">{labels.query} {decision.query}</p>}
              {read && <p className="mt-2 break-words text-xs text-neutral-400">{labels.result} {labels.readStatuses[read.status] ?? read.status}{read.reason ? ` (${read.reason.replaceAll("_", " ")})` : ""}</p>}
              <ul className="mt-3 space-y-3">
                {decision.hypotheses.map((hypothesis, hypothesisIndex) => <li key={hypothesisIndex} className="min-w-0 border-l border-neutral-700 pl-3 text-sm">
                  <p className="whitespace-pre-wrap break-words text-neutral-200">{hypothesis.hypothesis}</p>
                  <div className="mt-1 text-neutral-400">{labels.supports} {citations(hypothesis.supporting_ids)}</div>
                  <div className="mt-1 text-neutral-400">{labels.contradicts} {citations(hypothesis.refuting_ids)}</div>
                  {hypothesis.missing && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-amber-300">{labels.needed} {hypothesis.missing}</p>}
                </li>)}
              </ul>
            </li>;
          })}
        </ol>
        {!decisions.length && <p className="text-sm text-neutral-400">{labels.noDecisions}</p>}
      </section>

      <section aria-labelledby={`${instanceId}-unresolved`} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <h2 id={`${instanceId}-unresolved`} className="mb-3 text-lg font-semibold text-white">{labels.unresolved}</h2>
        {missing.length ? <ul className="list-disc space-y-2 pl-5 text-sm text-amber-200">{missing.map((item) => <li key={item} className="whitespace-pre-wrap break-words">{item}</li>)}</ul>
          : <p className="text-sm text-neutral-400">{labels.noMissing}</p>}
        {diagnosis.root_causes.length > 0 && <div className="mt-4 space-y-3">
          <h3 className="text-sm font-medium text-neutral-200">{labels.nextChecks}</h3>
          {diagnosis.root_causes.map((cause, causeIndex) => <div key={causeIndex} className="min-w-0 border-l border-neutral-700 pl-3 text-sm">
            <p className="whitespace-pre-wrap break-words text-neutral-200">{cause.hypothesis}</p>
            <div className="mt-1 text-neutral-400">{labels.supports} {citations(cause.supporting_ids)}</div>
            <div className="mt-1 text-neutral-400">{labels.contradicts} {citations(cause.refuting_ids)}</div>
            {cause.next_check.trim() && <p className="mt-2 whitespace-pre-wrap break-words text-neutral-400">{labels.nextCheck} {cause.next_check}</p>}
          </div>)}
        </div>}
      </section>

      <section aria-labelledby={`${instanceId}-workspace`} className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 id={`${instanceId}-workspace`} className="mb-3 text-lg font-semibold text-white">{labels.evidence}</h2>
        <p className="text-xs text-neutral-500">{labels.sourceHint}</p>
        {(index.missingIds.length > 0 || index.ambiguousIds.length > 0) && <section aria-labelledby={`${instanceId}-audit`} className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 id={`${instanceId}-audit`} className="text-sm font-medium text-amber-200">{labels.audit} · {labels.review}</h3>
          <p className="mt-2 text-xs text-neutral-400">{labels.auditHint}</p>
          {index.missingIds.length > 0 && <div className="mt-2 text-xs text-amber-200"><p>{labels.missingIds}</p><ul className="mt-1 flex flex-wrap gap-2">{index.missingIds.map((id) => <li key={id} className="max-w-full break-all font-mono">{id}</li>)}</ul></div>}
          {index.ambiguousIds.length > 0 && <div className="mt-2 text-xs text-amber-200"><p>{labels.ambiguousIds}</p><ul className="mt-1 flex flex-wrap gap-2">{index.ambiguousIds.map((id) => <li key={id} className="max-w-full break-all font-mono">{id}</li>)}</ul></div>}
        </section>}

        {index.evidence.length > 0 && <div className="mt-4 space-y-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <label htmlFor={`${instanceId}-query`} className="text-xs text-neutral-400">{labels.search}</label>
              <input id={`${instanceId}-query`} type="search" value={filters.query} maxLength={200} placeholder={labels.searchPlaceholder} aria-describedby={`${instanceId}-search-hint`} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} className={INPUT_CLASS} />
              <p id={`${instanceId}-search-hint`} className="text-xs text-neutral-500">{labels.searchHint}</p>
            </div>
            <label htmlFor={`${instanceId}-kind`} className="flex min-w-0 flex-col gap-1 text-xs text-neutral-400">
              <span>{labels.kind}</span>
              <select id={`${instanceId}-kind`} value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value as EvidenceFilter["kind"] }))} className={INPUT_CLASS}>
                <option value="all">{labels.allKinds}</option>{EVIDENCE_KINDS.map((kind) => <option key={kind} value={kind}>{labels.kinds[kind]}</option>)}
              </select>
            </label>
            <label htmlFor={`${instanceId}-service`} className="flex min-w-0 flex-col gap-1 text-xs text-neutral-400">
              <span>{labels.service}</span>
              <select id={`${instanceId}-service`} value={filters.service} aria-describedby={`${instanceId}-service-hint`} onChange={(event) => setFilters((current) => ({ ...current, service: event.target.value }))} className={INPUT_CLASS}>
                <option value="">{labels.allServices}</option>{services.map((service) => <option key={service} value={service}>{service.trim() === service ? service : JSON.stringify(service)}</option>)}
              </select>
            </label>
            <label htmlFor={`${instanceId}-usage`} className="flex min-w-0 flex-col gap-1 text-xs text-neutral-400">
              <span>{labels.usage}</span>
              <select id={`${instanceId}-usage`} value={filters.usage} onChange={(event) => setFilters((current) => ({ ...current, usage: event.target.value as EvidenceFilter["usage"] }))} className={INPUT_CLASS}>
                <option value="all">{labels.allUsage}</option><option value="cited">{labels.cited}</option><option value="uncited">{labels.uncited}</option>
              </select>
            </label>
            <div className="flex items-end"><button type="button" onClick={() => setFilters({ ...DEFAULT_EVIDENCE_FILTER })} className={BUTTON_CLASS}>{labels.clear}</button></div>
          </div>
          <p id={`${instanceId}-service-hint`} className="text-xs text-neutral-500">{labels.serviceHint}</p>
        </div>}

        <p role="status" aria-live="polite" className="my-3 text-xs text-neutral-400">{visible.length.toLocaleString(locale)} / {index.evidence.length.toLocaleString(locale)} {labels.shown}</p>
        {!index.evidence.length ? <p className="text-sm text-neutral-400">{labels.noEvidence}</p>
          : !visible.length ? <p className="rounded-lg border border-neutral-800 p-3 text-sm text-neutral-400">{labels.noMatches}</p>
            : <ul className="min-w-0 space-y-2">
              {visible.map((item) => {
                const open = selectedRecord === item.recordKey;
                const domId = `${instanceId}-${item.recordKey}`;
                return <li key={item.recordKey} className="min-w-0 scroll-mt-6 rounded-lg border border-neutral-800 p-3">
                  <button id={`${domId}-toggle`} type="button" aria-expanded={open} aria-controls={`${domId}-details`} onClick={() => setSelectedRecord(open ? null : item.recordKey)} className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">
                    <span className="max-w-full break-all font-mono text-sm text-indigo-300">{item.id}</span>
                    <span className="min-w-0 break-words text-xs text-neutral-500">{labels.kinds[item.kind]}{item.service ? ` · ${item.service}` : ""}</span>
                    {index.ambiguousIds.includes(item.id) && <span className="text-xs text-amber-300">{labels.review}</span>}
                    <span className="ml-auto text-xs text-neutral-400">{open ? labels.hide : labels.inspect}</span>
                  </button>
                  <div id={`${domId}-details`} hidden={!open} className="mt-3 min-w-0 space-y-3">
                    {item.kind === "user_context" && <p className="text-xs text-amber-300">{labels.unverified}</p>}
                    <dl className="grid min-w-0 gap-2 text-xs text-neutral-400">
                      <div><dt className="text-neutral-500">{labels.source}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{item.source || labels.notRecorded}</dd></div>
                      <div><dt className="text-neutral-500">{labels.observed}</dt><dd className="mt-1 break-words font-mono">{item.observed_at || labels.notRecorded}</dd></div>
                      <div><dt className="text-neutral-500">{labels.available}</dt><dd className="mt-1 break-words font-mono">{item.available_at || labels.notRecorded}</dd></div>
                      {item.measurement && <div><dt className="text-neutral-500">{labels.measurement}</dt><dd className="mt-1 break-words">{item.measurement.metric}: {item.measurement.value} {item.measurement.unit} · {labels.window}: {item.measurement.window || labels.notRecorded}</dd></div>}
                      <div><dt className="text-neutral-500">{labels.sourceHash}</dt><dd className="mt-1 break-all font-mono">{item.source_content_hash || labels.notRecorded}</dd></div>
                    </dl>
                    <p className="text-xs text-neutral-500">{labels.hashHint}</p>
                    <pre tabIndex={0} aria-label={`${labels.body} ${item.id}`} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-3 text-xs text-neutral-300 focus-visible:outline-2 focus-visible:outline-indigo-400">{item.text || labels.notRecorded}</pre>
                  </div>
                </li>;
              })}
            </ul>}
      </section>
    </div>
  );
}
