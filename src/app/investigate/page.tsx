"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { InvestigationReview, type InvestigationReviewHandle } from "@/components/InvestigationReview";
import { InvestigationComparison } from "@/components/InvestigationComparison";
import { InvestigationExport } from "@/components/InvestigationExport";
import { ContextFileImport } from "@/components/ContextFileImport";
import { IncidentCredentialReview } from "@/components/IncidentCredentialReview";
import type { IncidentInput } from "@/components/IncidentInputForm";
import { Nav } from "@/components/Nav";
import type { Diagnosis } from "@/lib/agent/diagnosis";
import type { InvestigationAnalysis } from "@/lib/agent/presentation";
import type { InvestigationResult, TraceStep } from "@/lib/agent/types";
import { readApiError } from "@/lib/http";
import { useLocale } from "@/lib/i18n/client";
import { t, type Locale } from "@/lib/i18n/messages";
import { buildInvestigationEvidenceIndex, type InvestigationEvidenceIndex } from "@/lib/investigationEvidence";
import type { InvestigationReportContext } from "@/lib/investigationReport";
import { composeImportedContext, type ContextAttachment } from "@/lib/contextFiles";
import { prepareIncidentSubmission } from "@/lib/incidentPreflight";
import { INPUT_LIMITS } from "@/lib/requestSafety";

const SCENARIO_OPTIONS = [
  { slug: "db-connection-pool-exhausted", label: { en: "DB connection pool exhaustion (payment-svc)", zh: "数据库连接池耗尽（payment-svc）" } },
  { slug: "bad-deploy-memory-leak", label: { en: "OOM crashloop after deploy (order-svc)", zh: "部署后内存不足反复重启（order-svc）" } },
  { slug: "upstream-dependency-timeout", label: { en: "Upstream gateway timeout cascade (checkout-svc)", zh: "上游网关超时引发级联故障（checkout-svc）" } },
  { slug: "dns-misconfiguration", label: { en: "Regional 5xx after DNS change (api-gateway)", zh: "DNS 变更后区域性 5xx（api-gateway）" } },
  { slug: "cache-stampede", label: { en: "Cache stampede on Black Friday (catalog-svc)", zh: "黑色星期五缓存击穿（catalog-svc）" } },
];

const LABELS = {
  en: {
    title: "Incident investigator", subtitle: "Start with an alert. The investigator gathers metrics, logs, deployment history, and runbooks, then records its checks and the evidence behind its conclusions.",
    scenario: "Investigation scenario", custom: "Custom incident", sample: "Sample scenario", titleField: "Incident title", serviceField: "Service", symptomsField: "Symptoms / alert", contextField: "Incident context", contextHelp: "Paste an alert, timeline, logs, or other evidence. User-provided details are treated as unverified context.",
    output: "Investigation output language", depth: "Investigation depth", focused: "Focused · 3 steps", standard: "Standard · 8 steps", thorough: "Thorough · 12 steps", run: "Run investigation", stop: "Stop investigation", characters: "characters", customReport: "Custom incident", untitled: "Untitled incident", inputTooLong: "is over the allowed length", inputTooShort: "must contain at least 20 characters", finishImport: "Finish or discard the file import before starting the investigation.",
    loading: "Gathering evidence and preparing the report…", stopped: "Investigation stopped. Run again to produce a report.", stoppedWithPrevious: "Investigation stopped. The previous completed report is still available.", failed: "Investigation failed",
    trace: "Investigation trace", structured: "Structured response", snapshot: "Report scenario", requested: "Requested output", unknown: "Unknown severity",
    diagnosis: "Diagnosis status", claims: "Claims and citations", noClaims: "No factual claims recorded.",
    hypotheses: "Review supporting and contradicting evidence for each hypothesis.", noCauses: "No evidence-backed cause established.",
    supporting: "Supporting evidence", refuting: "Contradicting evidence", noRefs: "None cited", unavailable: "unavailable", ambiguous: "ambiguous record", open: "Open evidence",
    kinds: { observed: "Observed", derived: "Derived", inference: "Inference", hypothesis: "Hypothesis" },
    conclusion: { supported: "Supported", tentative: "Tentative", insufficient_evidence: "Insufficient evidence" },
    complete: "Completed", partial: "Incomplete investigation", stopReason: "Stopped because", steps: "Investigation steps", calls: "Model calls", toolCalls: "Successful reads", tokens: "Tokens", cost: "Cost",
    statuses: { ok: "Read succeeded", empty: "No data", refused: "Refused", error: "Read failed" },
  },
  zh: {
    title: "故障调查", subtitle: "从告警开始。调查员收集指标、日志、部署历史和运维手册，并记录排查步骤与结论所引用的证据。",
    scenario: "调查场景", custom: "自定义故障", sample: "示例场景", titleField: "故障标题", serviceField: "服务", symptomsField: "症状 / 告警", contextField: "故障上下文", contextHelp: "粘贴告警、时间线、日志或其他证据。用户提供的信息将作为未经独立验证的上下文处理。",
    output: "调查输出语言", depth: "调查深度", focused: "快速 · 3 步", standard: "标准 · 8 步", thorough: "深入 · 12 步", run: "开始调查", stop: "停止调查", characters: "字符", customReport: "自定义故障", untitled: "未命名故障", inputTooLong: "超过允许的长度", inputTooShort: "至少需要 20 个字符", finishImport: "请先完成或丢弃文件导入，再开始调查。",
    loading: "正在收集证据并生成报告…", stopped: "调查已停止。请重新运行以生成报告。", stoppedWithPrevious: "调查已停止，之前完成的报告仍可查看。", failed: "调查失败",
    trace: "调查记录", structured: "结构化响应", snapshot: "报告场景", requested: "请求的输出语言", unknown: "严重等级未知",
    diagnosis: "诊断状态", claims: "结论与引用", noClaims: "未记录事实性结论。",
    hypotheses: "请检查每个假设的支持证据与反证。", noCauses: "尚未确定有证据支持的原因。",
    supporting: "支持证据", refuting: "反证", noRefs: "未引用", unavailable: "不可用", ambiguous: "记录存在歧义", open: "打开证据",
    kinds: { observed: "观察", derived: "计算", inference: "推断", hypothesis: "假设" },
    conclusion: { supported: "有证据支持", tentative: "暂定", insufficient_evidence: "证据不足" },
    complete: "已完成", partial: "调查未完成", stopReason: "停止原因", steps: "调查步骤", calls: "模型调用", toolCalls: "成功读取", tokens: "Token", cost: "费用",
    statuses: { ok: "读取成功", empty: "无数据", refused: "已拒绝", error: "读取失败" },
  },
};

const STATUS_STYLE: Record<TraceStep["status"], { icon: string; cls: string }> = {
  ok: { icon: "✓", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
  empty: { icon: "∅", cls: "text-neutral-400 border-neutral-600/40 bg-neutral-500/5" },
  refused: { icon: "⛔", cls: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
  error: { icon: "✗", cls: "text-red-400 border-red-500/30 bg-red-500/5" },
};

const SEV_STYLE: Record<string, string> = {
  SEV1: "bg-red-500/15 text-red-300 border-red-500/40",
  SEV2: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  SEV3: "bg-sky-500/15 text-sky-300 border-sky-500/40",
};

function TraceTimeline({ trace, locale }: { trace: TraceStep[]; locale: Locale }) {
  const labels = LABELS[locale];
  const id = useId();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="flex flex-col gap-2">
      {trace.map((s) => {
        const st = STATUS_STYLE[s.status];
        const isOpen = open === s.index;
        return (
          <li key={s.index} className={`rounded-lg border ${st.cls} px-3 py-2`}>
            <button type="button" aria-expanded={isOpen} aria-controls={`${id}-${s.index}`} className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-left focus-visible:outline-2 focus-visible:outline-indigo-400" onClick={() => setOpen(isOpen ? null : s.index)}>
              <span className="font-mono text-xs opacity-60">{s.index}</span>
              <span className="text-base">{st.icon}</span>
              <span className="min-w-0 break-words font-mono text-sm text-neutral-200">{s.tool}</span>
              <span className="ml-auto min-w-0 break-words text-xs opacity-80">{labels.statuses[s.status]}{s.reason ? ` · ${s.reason}` : ""}</span>
              <span className="basis-full truncate font-mono text-xs text-neutral-500">{JSON.stringify(s.input)}</span>
            </button>
            {isOpen && (
              <pre id={`${id}-${s.index}`} className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-3 text-xs text-neutral-300">{s.observation}</pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

function EvidenceReferences({ ids, index, onRevealEvidence, locale }: {
  ids: string[]; index: InvestigationEvidenceIndex; onRevealEvidence: (id: string) => void; locale: Locale;
}) {
  const labels = LABELS[locale];
  const known = new Set(index.evidence.map(item => item.id));
  const ambiguous = new Set(index.ambiguousIds);
  if (!ids.length) return <span className="text-xs text-neutral-500">{labels.noRefs}</span>;
  return <span className="inline-flex flex-wrap gap-2">
    {[...new Set(ids)].map(id => !known.has(id) || ambiguous.has(id)
      ? <span key={id} className="break-all font-mono text-xs text-amber-300">{id} ({ambiguous.has(id) ? labels.ambiguous : labels.unavailable})</span>
      : <button key={id} type="button" onClick={() => onRevealEvidence(id)} aria-label={`${labels.open}: ${id}`} className="break-all font-mono text-xs text-indigo-300 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-indigo-400">{id}</button>)}
  </span>;
}

function AnalysisView({ a, diagnosis, evidenceIndex, onRevealEvidence, locale }: {
  a: InvestigationAnalysis; diagnosis: Diagnosis; evidenceIndex: InvestigationEvidenceIndex; onRevealEvidence: (id: string) => void; locale: Locale;
}) {
  const labels = LABELS[locale];
  const section = (key: string) => t(locale, key);
  return (
    <div className="flex flex-col gap-4">
      <Section title={section("section.summary")}>
        <div className="mb-3 flex items-center gap-3">
          <span className={`rounded border px-2 py-0.5 text-sm font-bold ${SEV_STYLE[a.severity ?? "unknown"] ?? "border-neutral-600"}`}>{a.severity ?? labels.unknown}</span>
          <span className="text-xs text-neutral-400">{a.severity_reasoning}</span>
        </div>
        <p className="mb-2 text-xs text-neutral-400">{labels.diagnosis}: {labels.conclusion[diagnosis.conclusion_status]}</p>
        <p className="text-sm text-neutral-200">{a.summary}</p>
      </Section>

      <Section title={`${labels.claims} (${diagnosis.claims.length})`}>
        {diagnosis.claims.length === 0 && <p className="text-sm text-neutral-400">{labels.noClaims}</p>}
        <ul className="space-y-2">
          {diagnosis.claims.map(claim => <li key={claim.id} className="text-sm text-neutral-200">
            <span className="mr-2 text-xs text-neutral-500">{labels.kinds[claim.kind]}</span>{claim.text}
            <div className="mt-1"><EvidenceReferences ids={claim.evidence_ids} index={evidenceIndex} onRevealEvidence={onRevealEvidence} locale={locale} /></div>
          </li>)}
        </ul>
      </Section>

      <Section title={`${section("section.rootCauses")} (${a.root_causes.length})`}>
        <p className="text-xs text-neutral-500">{labels.hypotheses}</p>
        {a.root_causes.length === 0 && <p className="text-sm text-neutral-400">{labels.noCauses}</p>}
        <ul className="flex flex-col gap-2">
          {a.root_causes.map((rc, i) => (
            <li key={i} className="text-sm">
              <span className="mr-2 rounded px-1.5 py-0.5 text-xs font-semibold bg-neutral-500/15 text-neutral-300">{labels.kinds.hypothesis}</span>
              <span className="text-neutral-200">{rc.hypothesis}</span>
              {diagnosis.root_causes[i] ? <div className="mt-2 space-y-1 text-xs text-neutral-400">
                <div>{labels.supporting}: <EvidenceReferences ids={diagnosis.root_causes[i].supporting_ids} index={evidenceIndex} onRevealEvidence={onRevealEvidence} locale={locale} /></div>
                <div>{labels.refuting}: <EvidenceReferences ids={diagnosis.root_causes[i].refuting_ids} index={evidenceIndex} onRevealEvidence={onRevealEvidence} locale={locale} /></div>
              </div> : <div className="mt-0.5 pl-1 text-xs text-neutral-500">{rc.evidence}</div>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`${section("section.investigation")} (${a.investigation_checklist.length})`}>
        <ol className="flex flex-col gap-3">
          {a.investigation_checklist.map((step, i) => (
            <li key={i} className="text-sm">
              <div className="text-neutral-200">{i + 1}. {step.step}</div>
              {step.command && <pre className="my-1 overflow-x-auto rounded bg-black/50 px-2 py-1 font-mono text-xs text-emerald-300">{step.command}</pre>}
              <div className="text-xs text-neutral-500">{section("section.expected")} {step.expected}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={`${section("section.mitigation")} (${a.mitigation_plan.length})`}>
        <ul className="flex flex-col gap-2">
          {a.mitigation_plan.map((m, i) => (
            <li key={i} className="text-sm">
              <div className="text-neutral-200">▸ {m.action}</div>
              <div className="pl-3 text-xs text-amber-300/80">{section("section.risk")} {m.risk}</div>
              <div className="pl-3 text-xs text-emerald-300/80">{section("section.rollback")} {m.rollback}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={section("section.customerImpact")}>
        <p className="text-sm text-neutral-200">{a.customer_impact}</p>
      </Section>

      <Section title={section("section.postmortem")}>
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{a.postmortem_draft}</ReactMarkdown>
        </div>
      </Section>

      <Section title={`${section("section.followUps")} (${a.follow_ups.length})`}>
        <ul className="flex flex-col gap-1">
          {a.follow_ups.map((f, i) => (
            <li key={i} className="text-sm text-neutral-200">
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${f.priority === "P0" ? "bg-red-500/15 text-red-300" : f.priority === "P1" ? "bg-amber-500/15 text-amber-300" : "bg-neutral-500/15 text-neutral-300"}`}>{f.priority}</span>
              {f.item} <span className="text-xs text-neutral-500">— {f.owner_role}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default function InvestigatePage() {
  const locale = useLocale();
  const labels = LABELS[locale];
  const [slug, setSlug] = useState(SCENARIO_OPTIONS[0].slug);
  const [mode, setMode] = useState<"scenario" | "custom">("scenario");
  const [customInput, setCustomInput] = useState<IncidentInput>({ title: "", service: "", symptoms: "", raw_context: "", prompt_version: "v3", output_language: "en" });
  const [importBusy, setImportBusy] = useState(false);
  const [lang, setLang] = useState<"en" | "zh">("en");
  const [maxSteps, setMaxSteps] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ result: InvestigationResult; context: InvestigationReportContext; runId: number } | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<{ result: InvestigationResult; context: InvestigationReportContext; runId: number } | null>(null);
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const reviewRef = useRef<InvestigationReviewHandle | null>(null);
  const result = snapshot?.result ?? null;
  const evidenceIndex = useMemo(() => buildInvestigationEvidenceIndex(result), [result]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  async function run() {
    if (mode === "custom" && importBusy) {
      setError(labels.finishImport);
      return;
    }
    let requestBody: Record<string, string | number>;
    let context: InvestigationReportContext;
    if (mode === "custom") {
      const prepared = prepareIncidentSubmission({ ...customInput, output_language: lang });
      if (!prepared.ok) {
        const fieldName = prepared.field === "raw_context" ? labels.contextField : prepared.field === "title" ? labels.titleField : prepared.field === "service" ? labels.serviceField : labels.symptomsField;
        setError(`${fieldName} ${prepared.error === "too_long" ? labels.inputTooLong : labels.inputTooShort} (${prepared.limit} ${labels.characters}).`);
        return;
      }
      setCustomInput(prepared.input);
      context = { scenario_slug: "custom", title: prepared.input.title || labels.untitled, service: prepared.input.service, requested_language: lang, max_steps_requested: maxSteps };
      requestBody = { title: prepared.input.title, service: prepared.input.service, symptoms: prepared.input.symptoms, raw_context: prepared.input.raw_context, output_language: lang, max_steps: maxSteps };
    } else {
      context = { scenario_slug: slug, requested_language: lang, max_steps_requested: maxSteps };
      requestBody = { scenario_slug: slug, output_language: lang, max_steps: maxSteps };
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = ++runIdRef.current;
    if (snapshot) setPreviousSnapshot(snapshot);
    setLoading(true);
    setError(null);
    setStopped(false);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!res.ok) {
        const message = await readApiError(res, labels.failed);
        if (abortRef.current === controller && !controller.signal.aborted) setError(message);
        return;
      }
      const response = await res.json() as InvestigationResult;
      if (abortRef.current !== controller || controller.signal.aborted) return;
      setSnapshot({ result: response, context: { ...context, generated_at: new Date().toISOString() }, runId });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (abortRef.current === controller && !controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStopped(true);
  }

  function onRevealEvidence(id: string) {
    reviewRef.current?.revealEvidence(id);
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{labels.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-400">
              {labels.subtitle}
            </p>
          </div>
          <Nav />
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div role="group" aria-label={labels.scenario} className="flex rounded-lg border border-neutral-700 p-1">
            <button type="button" aria-pressed={mode === "scenario"} disabled={loading} onClick={() => setMode("scenario")} className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${mode === "scenario" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>{labels.sample}</button>
            <button type="button" aria-pressed={mode === "custom"} disabled={loading} onClick={() => setMode("custom")} className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${mode === "custom" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>{labels.custom}</button>
          </div>
          {mode === "scenario" && <select aria-label={labels.scenario} value={slug} disabled={loading} onChange={(e) => setSlug(e.target.value)} className="w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50 sm:w-auto sm:max-w-full">
            {SCENARIO_OPTIONS.map((o) => <option key={o.slug} value={o.slug}>{o.label[locale]}</option>)}
          </select>}
          <select aria-label={labels.output} value={lang} onChange={(e) => setLang(e.target.value as "en" | "zh")} className="min-w-0 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
            <option value="en">Output: English</option>
            <option value="zh">输出：中文</option>
          </select>
          <select aria-label={labels.depth} value={maxSteps} disabled={loading} onChange={(e) => setMaxSteps(Number(e.target.value))} className="min-w-0 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50">
            <option value={3}>{labels.focused}</option>
            <option value={8}>{labels.standard}</option>
            <option value={12}>{labels.thorough}</option>
          </select>
          <button
            type="button"
            onClick={loading ? stop : run}
            disabled={!loading && importBusy}
            className={`rounded px-4 py-2 text-sm font-semibold text-white ${
              loading ? "bg-red-700 hover:bg-red-600" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {loading ? labels.stop : labels.run}
          </button>
        </div>

        {mode === "custom" && <section aria-label={labels.custom} className="mb-6 flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-neutral-300">{labels.titleField}<input value={customInput.title} maxLength={INPUT_LIMITS.shortText} disabled={loading} onChange={(e) => setCustomInput(current => ({ ...current, title: e.target.value }))} className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 disabled:opacity-50" /></label>
            <label className="flex flex-col gap-1 text-sm text-neutral-300">{labels.serviceField}<input value={customInput.service} maxLength={INPUT_LIMITS.shortText} disabled={loading} onChange={(e) => setCustomInput(current => ({ ...current, service: e.target.value }))} className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 disabled:opacity-50" /></label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-neutral-300">{labels.symptomsField}<input value={customInput.symptoms} maxLength={INPUT_LIMITS.shortText} disabled={loading} onChange={(e) => setCustomInput(current => ({ ...current, symptoms: e.target.value }))} className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 disabled:opacity-50" /></label>
          <label className="flex flex-col gap-1 text-sm text-neutral-300">{labels.contextField}<span className="text-xs text-neutral-500">{labels.contextHelp}</span>
            <textarea value={customInput.raw_context} maxLength={INPUT_LIMITS.rawContext} rows={8} disabled={loading} onChange={(e) => setCustomInput(current => ({ ...current, raw_context: e.target.value }))} className="resize-y rounded border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-100 disabled:opacity-50" />
            <span className="text-right text-xs text-neutral-500">{customInput.raw_context.length.toLocaleString(locale)} / {INPUT_LIMITS.rawContext.toLocaleString(locale)} {labels.characters}</span>
          </label>
          <ContextFileImport rawContext={customInput.raw_context} disabled={loading} onBusyChange={setImportBusy} onApply={(attachments: ContextAttachment[], fileMode) => {
            const composed = composeImportedContext(customInput.raw_context, attachments, fileMode);
            if (composed.ok) setCustomInput(current => ({ ...current, raw_context: composed.text }));
          }} />
          <IncidentCredentialReview value={customInput} onChange={setCustomInput} disabled={loading} />
        </section>}

        {loading && (
          <div className="mb-6 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
            {labels.loading}
          </div>
        )}
        {stopped && <p role="status" className="mb-6 text-sm text-neutral-400">{snapshot ? labels.stoppedWithPrevious : labels.stopped}</p>}
        {error && <div role="alert" className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

        {result && snapshot && (
          <div className="flex flex-col gap-6">
            <p className="text-sm text-neutral-400">{labels.snapshot}: {snapshot.context.scenario_slug === "custom" ? `${labels.customReport}${snapshot.context.title ? ` · ${snapshot.context.title}` : ""}${snapshot.context.service ? ` (${snapshot.context.service})` : ""}` : SCENARIO_OPTIONS.find(option => option.slug === snapshot.context.scenario_slug)?.label[locale] ?? snapshot.context.scenario_slug} · {labels.requested}: {snapshot.context.requested_language} · {labels.depth}: {snapshot.context.max_steps_requested}</p>
            {previousSnapshot && previousSnapshot.runId !== snapshot.runId && <InvestigationComparison key={`${previousSnapshot.runId}-${snapshot.runId}`} previous={previousSnapshot.result} current={snapshot.result} previousContext={previousSnapshot.context} currentContext={snapshot.context} locale={locale} />}
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-400">
              <span>{labels.stopReason}: <b className="text-neutral-200">{result.stop_reason}</b></span>
              <span>{labels.steps}: <b className="text-neutral-200">{result.steps}</b></span>
              <span>{labels.calls}: <b className="text-neutral-200">{result.usage.model_calls}</b></span>
              <span>{labels.toolCalls}: <b className="text-neutral-200">{result.trace.filter((s) => s.status === "ok").length}</b></span>
              <span>{labels.tokens}: <b className="text-neutral-200">{result.usage.tokens_in}/{result.usage.tokens_out}</b></span>
              <span>{labels.cost}: <b className="text-neutral-200">${result.usage.cost_usd.toFixed(5)}</b></span>
              <span className={result.completed ? "text-emerald-300" : "font-medium text-amber-300"}>{result.completed ? labels.complete : labels.partial}</span>
            </div>

            <InvestigationExport key={snapshot.runId} result={result} context={snapshot.context} />

            <div>
              <h2 className="mb-3 text-lg font-semibold text-white">{labels.trace}</h2>
              <TraceTimeline key={snapshot.runId} trace={result.trace} locale={locale} />
            </div>

            <InvestigationReview key={snapshot.runId} ref={reviewRef} decisions={result.decisions} evidence={result.evidence ?? []} trace={result.trace} diagnosis={result.diagnosis} />

            <div>
              <h2 className="mb-3 text-lg font-semibold text-white">{labels.structured}</h2>
              <AnalysisView a={result.analysis} diagnosis={result.diagnosis} evidenceIndex={evidenceIndex} onRevealEvidence={onRevealEvidence} locale={locale} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
