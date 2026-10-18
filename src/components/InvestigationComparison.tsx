import type { InvestigationResult } from "@/lib/agent/types";
import type { Locale } from "@/lib/i18n/messages";

const LABELS = {
  en: {
    title: "Changes since the previous run",
    old: "Previous run", current: "Latest run", severity: "Severity", conclusion: "Conclusion", completion: "Completion", steps: "Steps", evidence: "Evidence records", calls: "Model calls", cost: "Cost",
    summary: "Diagnosis summary", hypotheses: "Root cause hypotheses", claims: "Evidence-backed claims", evidenceIds: "Evidence IDs",
    added: "Added", removed: "Removed", unchanged: "No changes", none: "None", complete: "Complete", incomplete: "Incomplete", unknown: "Unknown",
    statuses: { supported: "Supported", tentative: "Tentative", insufficient_evidence: "Insufficient evidence" },
    note: "Runs may use different incident details or depth settings. A change shows what the investigator reported; it does not confirm that the incident changed.",
  },
  zh: {
    title: "与上次调查的变化",
    old: "上次调查", current: "本次调查", severity: "严重等级", conclusion: "诊断结论", completion: "完成状态", steps: "步骤", evidence: "证据记录", calls: "模型调用", cost: "费用",
    summary: "诊断摘要", hypotheses: "根因假设", claims: "有证据引用的结论", evidenceIds: "证据 ID",
    added: "新增", removed: "移除", unchanged: "没有变化", none: "无", complete: "已完成", incomplete: "未完成", unknown: "未知",
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

export function InvestigationComparison({ previous, current, locale }: {
  previous: InvestigationResult;
  current: InvestigationResult;
  locale: Locale;
}) {
  const labels = LABELS[locale];
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

  return (
    <details className="overflow-hidden rounded-xl border border-indigo-500/30 bg-indigo-500/5">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-indigo-200 focus-visible:outline-2 focus-visible:outline-indigo-400">{labels.title}</summary>
      <div className="space-y-4 border-t border-indigo-500/20 p-4">
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
