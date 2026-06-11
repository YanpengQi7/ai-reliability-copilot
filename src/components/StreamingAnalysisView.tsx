"use client";

import ReactMarkdown from "react-markdown";
import { useT } from "@/lib/i18n/client";

export type PartialAnalysis = Partial<{
  summary: string;
  severity: string;
  severity_reasoning: string;
  root_causes: Array<{ hypothesis?: string; evidence?: string; likelihood?: string } | undefined>;
  investigation_checklist: Array<{ step?: string; command?: string; expected?: string } | undefined>;
  mitigation_plan: Array<{ action?: string; risk?: string; rollback?: string } | undefined>;
  customer_impact: string;
  postmortem_draft: string;
  follow_ups: Array<{ item?: string; owner_role?: string; priority?: string } | undefined>;
}>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  const color =
    severity === "SEV1" ? "bg-red-500/20 text-red-300 border-red-500/40" :
    severity === "SEV2" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  return <span className={`inline-block text-xs px-2 py-1 rounded border ${color}`}>{severity}</span>;
}

export function StreamingAnalysisView({ analysis }: { analysis: PartialAnalysis }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 w-full">
      {(analysis.summary || analysis.severity) && (
        <Section title={t("section.summary")}>
          <div className="flex items-start gap-3">
            <SeverityBadge severity={analysis.severity} />
            <p className="text-neutral-200">{analysis.summary || "..."}</p>
          </div>
          {analysis.severity_reasoning && (
            <p className="text-sm text-neutral-400 mt-2">
              {t("section.severityReasoning")} {analysis.severity_reasoning}
            </p>
          )}
        </Section>
      )}

      {analysis.root_causes && analysis.root_causes.length > 0 && (
        <Section title={t("section.rootCauses")}>
          <ul className="space-y-3">
            {analysis.root_causes.map((rootCause, index) =>
              rootCause ? (
                <li key={index} className="border-l-2 border-indigo-500/50 pl-3">
                  <div className="flex gap-2 items-center">
                    {rootCause.likelihood && <span className="text-xs uppercase text-neutral-500">{rootCause.likelihood}</span>}
                    <span className="font-medium">{rootCause.hypothesis}</span>
                  </div>
                  {rootCause.evidence && (
                    <p className="text-sm text-neutral-400 mt-1">
                      {t("section.evidence")} {rootCause.evidence}
                    </p>
                  )}
                </li>
              ) : null
            )}
          </ul>
        </Section>
      )}

      {analysis.investigation_checklist && analysis.investigation_checklist.length > 0 && (
        <Section title={t("section.investigation")}>
          <ol className="space-y-3 list-decimal list-inside">
            {analysis.investigation_checklist.map((step, index) =>
              step ? (
                <li key={index}>
                  <span className="font-medium">{step.step}</span>
                  {step.command && (
                    <pre className="mt-1 bg-neutral-950 border border-neutral-800 rounded p-2 text-xs overflow-x-auto">
                      <code>{step.command}</code>
                    </pre>
                  )}
                  {step.expected && (
                    <p className="text-xs text-neutral-400 mt-1">
                      {t("section.expected")} {step.expected}
                    </p>
                  )}
                </li>
              ) : null
            )}
          </ol>
        </Section>
      )}

      {analysis.mitigation_plan && analysis.mitigation_plan.length > 0 && (
        <Section title={t("section.mitigation")}>
          <ul className="space-y-3">
            {analysis.mitigation_plan.map((mitigation, index) =>
              mitigation ? (
                <li key={index}>
                  <p className="font-medium">{mitigation.action}</p>
                  {mitigation.risk && <p className="text-xs text-amber-300/80">{t("section.risk")} {mitigation.risk}</p>}
                  {mitigation.rollback && <p className="text-xs text-neutral-400">{t("section.rollback")} {mitigation.rollback}</p>}
                </li>
              ) : null
            )}
          </ul>
        </Section>
      )}

      {analysis.customer_impact && (
        <Section title={t("section.customerImpact")}>
          <p className="text-neutral-200 whitespace-pre-wrap">{analysis.customer_impact}</p>
        </Section>
      )}

      {analysis.postmortem_draft && (
        <Section title={t("section.postmortem")}>
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-li:text-neutral-300 prose-strong:text-neutral-100">
            <ReactMarkdown>{analysis.postmortem_draft}</ReactMarkdown>
          </div>
        </Section>
      )}

      {analysis.follow_ups && analysis.follow_ups.length > 0 && (
        <Section title={t("section.followUps")}>
          <ul className="space-y-2">
            {analysis.follow_ups.map((followUp, index) =>
              followUp ? (
                <li key={index} className="flex gap-2 text-sm">
                  {followUp.priority && <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">{followUp.priority}</span>}
                  <span className="text-neutral-200">{followUp.item}</span>
                  {followUp.owner_role && <span className="text-neutral-500">— {followUp.owner_role}</span>}
                </li>
              ) : null
            )}
          </ul>
        </Section>
      )}
    </div>
  );
}
