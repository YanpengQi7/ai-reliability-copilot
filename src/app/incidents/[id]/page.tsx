import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getIncidentWithAnalyses, hasSupabase, type AnalysisRow } from "@/lib/db";
import { CopyButton } from "@/components/CopyButton";
import { ReRunButton } from "@/components/ReRunButton";
import { EvaluateButton } from "@/components/EvaluateButton";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";
import { findSimilarIncidents } from "@/lib/similar";
import { buildSignature } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

export default async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  if (!hasSupabase()) {
    return <Shell><p className="text-neutral-400">{tr("incidents.dbMissing.title")}</p></Shell>;
  }
  const data = await getIncidentWithAnalyses(id);
  if (!data) return notFound();
  const { incident, analyses } = data;
  const latest = analyses[0];

  // Similar incidents — best-effort, never blocks page render
  const similarQuery = buildSignature({
    title: incident.title,
    service: incident.service,
    symptoms: incident.symptoms,
    summary: latest?.summary,
    severity: latest?.severity,
  });
  const similar = await findSimilarIncidents(similarQuery, { excludeId: incident.id, limit: 5 });

  return (
    <Shell>
      <header>
        <Link href="/incidents" className="text-sm text-neutral-400 hover:text-white">{tr("detail.allIncidents")}</Link>
        <h1 className="text-2xl font-bold mt-2">{incident.title || incident.service || tr("detail.untitled")}</h1>
        <p className="text-sm text-neutral-500 mt-1">
          {incident.service && <span className="mr-3">{tr("detail.service")} <span className="text-neutral-300">{incident.service}</span></span>}
          <span>{tr("detail.created")} {new Date(incident.created_at).toLocaleString()}</span>
        </p>
      </header>

      <Card title={tr("detail.rawContext")}>
        <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono">{incident.raw_context}</pre>
        <div className="mt-3">
          <ReRunButton incidentId={incident.id} />
        </div>
      </Card>

      {!latest && <p className="text-neutral-400">{tr("detail.noAnalyses")}</p>}
      {latest && (
        <>
          <div className="flex items-center justify-end">
            <EvaluateButton analysisId={latest.id} />
          </div>
          <AnalysisCard a={latest} locale={locale} />
        </>
      )}

      {similar.hits.length > 0 && (
        <Card title={tr("detail.similar.title")}>
          <p className="text-xs text-neutral-500 mb-3">{similar.mode === "vector" ? tr("detail.similar.mode.vector") : tr("detail.similar.mode.trigram")}</p>
          <ul className="divide-y divide-neutral-800">
            {similar.hits.map((h) => (
              <li key={h.id} className="py-2">
                <Link href={`/incidents/${h.id}`} className="flex items-center justify-between gap-3 group">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-200 group-hover:text-indigo-300 truncate">
                      {h.title || h.service || h.id.slice(0, 8)}
                    </p>
                    {h.symptoms && <p className="text-xs text-neutral-500 truncate">{h.symptoms}</p>}
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 shrink-0">
                    {(h.similarity * 100).toFixed(0)}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {analyses.length > 1 && (
        <details className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-sm">
          <summary className="cursor-pointer text-neutral-300">{analyses.length - 1} {tr("detail.earlierVersions")}</summary>
          <ul className="mt-3 space-y-2 text-neutral-400">
            {analyses.slice(1).map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded border border-neutral-700">{a.prompt_version}</span>
                {a.output_language && (
                  <span className="text-xs px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300">{a.output_language}</span>
                )}
                <span>{a.severity}</span>
                <span>·</span>
                <span>{a.model}</span>
                <span>·</span>
                <span>{new Date(a.created_at).toLocaleString()}</span>
                <span>·</span>
                <span>{a.latency_ms}ms</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-end">
          <Nav />
        </div>
        {children}
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function SeverityBadge({ s }: { s?: string | null }) {
  if (!s) return null;
  const color =
    s === "SEV1" ? "bg-red-500/20 text-red-300 border-red-500/40" :
    s === "SEV2" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  return <span className={`inline-block text-xs px-2 py-1 rounded border ${color}`}>{s}</span>;
}

type RootCause = { hypothesis?: string; evidence?: string; likelihood?: string };
type Step = { step?: string; command?: string; expected?: string };
type Mitig = { action?: string; risk?: string; rollback?: string };
type Follow = { item?: string; owner_role?: string; priority?: string };

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function AnalysisCard({ a, locale }: { a: AnalysisRow; locale: "en" | "zh" }) {
  const tr = (k: string) => t(locale, k);
  const rcs = asArr<RootCause>(a.root_causes);
  const checklist = asArr<Step>(a.investigation_checklist);
  const mitigation = asArr<Mitig>(a.mitigation_plan);
  const follow = asArr<Follow>(a.follow_ups);
  return (
    <div className="grid gap-4">
      <Card title={tr("section.summary")}>
        <div className="flex items-start gap-3">
          <SeverityBadge s={a.severity} />
          <p className="text-neutral-200">{a.summary}</p>
        </div>
        {a.severity_reasoning && (
          <p className="text-sm text-neutral-400 mt-2">{tr("section.severityReasoning")} {a.severity_reasoning}</p>
        )}
        <p className="text-xs text-neutral-500 mt-3 flex items-center gap-2 flex-wrap">
          <span>{a.model}</span>
          <span>·</span>
          <span>prompt {a.prompt_version}</span>
          {a.output_language && (
            <>
              <span>·</span>
              <span className="text-emerald-300">output: {a.output_language}</span>
            </>
          )}
          <span>·</span>
          <span>{a.latency_ms}ms</span>
          {(a.tokens_in != null || a.tokens_out != null) && (
            <>
              <span>·</span>
              <span>{a.tokens_in ?? 0}↑ / {a.tokens_out ?? 0}↓ tok</span>
            </>
          )}
          {a.cost_usd != null && (
            <>
              <span>·</span>
              <span>${Number(a.cost_usd).toFixed(5)}</span>
            </>
          )}
        </p>
      </Card>
      {rcs.length > 0 && (
        <Card title={tr("section.rootCauses")}>
          <ul className="space-y-3">
            {rcs.map((r, i) => (
              <li key={i} className="border-l-2 border-indigo-500/50 pl-3">
                <div className="flex gap-2 items-center">
                  <span className="text-xs uppercase text-neutral-500">{r.likelihood}</span>
                  <span className="font-medium">{r.hypothesis}</span>
                </div>
                <p className="text-sm text-neutral-400 mt-1">{tr("section.evidence")} {r.evidence}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {checklist.length > 0 && (
        <Card title={tr("section.investigation")}>
          <ol className="space-y-3 list-decimal list-inside">
            {checklist.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.step}</span>
                {s.command && (
                  <div className="mt-1 relative group">
                    <pre className="bg-neutral-950 border border-neutral-800 rounded p-2 text-xs overflow-x-auto"><code>{s.command}</code></pre>
                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={s.command} />
                    </div>
                  </div>
                )}
                <p className="text-xs text-neutral-400 mt-1">{tr("section.expected")} {s.expected}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {mitigation.length > 0 && (
        <Card title={tr("section.mitigation")}>
          <ul className="space-y-3">
            {mitigation.map((m, i) => (
              <li key={i}>
                <p className="font-medium">{m.action}</p>
                <p className="text-xs text-amber-300/80">{tr("section.risk")} {m.risk}</p>
                <p className="text-xs text-neutral-400">{tr("section.rollback")} {m.rollback}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a.customer_impact && <Card title={tr("section.customerImpact")}><p className="text-neutral-200 whitespace-pre-wrap">{a.customer_impact}</p></Card>}
      {a.postmortem_draft && (
        <Card title={tr("section.postmortem")}>
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-li:text-neutral-300 prose-strong:text-neutral-100">
            <ReactMarkdown>{a.postmortem_draft}</ReactMarkdown>
          </div>
        </Card>
      )}
      {follow.length > 0 && (
        <Card title={tr("section.followUps")}>
          <ul className="space-y-2">
            {follow.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">{f.priority}</span>
                <span className="text-neutral-200">{f.item}</span>
                <span className="text-neutral-500">— {f.owner_role}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
