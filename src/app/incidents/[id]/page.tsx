import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getIncidentWithAnalyses, hasSupabase, type AnalysisRow } from "@/lib/db";
import { CopyButton } from "@/components/CopyButton";
import { ReRunButton } from "@/components/ReRunButton";
import { EvaluateButton } from "@/components/EvaluateButton";
import { AnalysisComparison } from "@/components/AnalysisComparison";
import { AnalysisExport } from "@/components/AnalysisExport";
import { ResponseWorkspace } from "@/components/ResponseWorkspace";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";
import { findSimilarIncidents } from "@/lib/similar";
import { buildSignature } from "@/lib/embeddings";
import { supabaseAdmin } from "@/lib/supabase";
import { publicIncidentDataEnabled } from "@/lib/incidentAccess";
import { createDatabaseQuerySignal } from "@/lib/databaseDeadline";
import { resolveAnalysisSelection } from "@/lib/analysisSelection";
import { normalizeAnalysisContent } from "@/lib/analysisReview";
import { savedResponseWorkspaceId } from "@/lib/responseWorkspaceIdentity";

export const dynamic = "force-dynamic";

export default async function IncidentDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ analysis?: string | string[]; compare?: string | string[] }>;
}) {
  const { id } = await params;
  if (!publicIncidentDataEnabled()) return notFound();
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  if (!hasSupabase()) {
    return <Shell><p className="text-neutral-400">{tr("incidents.dbMissing.title")}</p></Shell>;
  }
  const databaseSignal = createDatabaseQuerySignal();
  const data = await getIncidentWithAnalyses(id, { abortSignal: databaseSignal });
  if (!data) return notFound();
  const { incident, analyses } = data;
  const latest = analyses[0];
  const { selected, baseline, invalidSelection } = resolveAnalysisSelection(analyses, await searchParams);
  const workspaceId = selected ? savedResponseWorkspaceId(incident.id, selected) : null;

  // Similar incidents — best-effort, never blocks page render
  const similarQuery = buildSignature({
    title: incident.title,
    service: incident.service,
    symptoms: incident.symptoms,
    summary: latest?.summary,
    severity: latest?.severity,
  });
  const similar = await findSimilarIncidents(similarQuery, { excludeId: incident.id, limit: 5, abortSignal: databaseSignal });

  // Bind the evidence audit to the displayed analysis, including historical runs.
  type UsedChunk = { chunk_id: string; similarity: number; rank: number; kb_chunks: { text: string; kb_documents: { title: string | null; source_path: string; kind: string } } };
  let usedChunks: UsedChunk[] = [];
  if (selected) {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("analysis_kb_chunks")
      .select("chunk_id, similarity, rank, kb_chunks(text, kb_documents(title, source_path, kind))")
      .eq("analysis_id", selected.id)
      .order("rank")
      .abortSignal(databaseSignal);
    usedChunks = (data ?? []) as unknown as UsedChunk[];
  }

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
        <pre className="max-h-80 overflow-auto text-xs text-neutral-300 whitespace-pre-wrap break-words font-mono">{incident.raw_context}</pre>
        <div className="mt-3">
          <ReRunButton incidentId={incident.id} />
        </div>
      </Card>

      {!selected && <p className="text-neutral-400">{tr("detail.noAnalyses")}</p>}
      {selected && (
        <>
          <Card title={tr("detail.review.title")}>
            <p className="mb-4 text-sm text-neutral-400">{tr("detail.review.body")}</p>
            <form key={`${selected.id}:${baseline?.id ?? ""}`} action={`/incidents/${incident.id}`} method="get" className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-sm">
                <span className="text-neutral-400">{tr("detail.review.selected")}</span>
                <select name="analysis" defaultValue={selected.id} className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2">
                  {analyses.map((analysis, index) => (
                    <option key={analysis.id} value={analysis.id}>
                      {analysisLabel(analysis, locale)}{index === 0 ? ` · ${tr("detail.review.latest")}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-sm">
                <span className="text-neutral-400">{tr("detail.review.baseline")}</span>
                <select name="compare" defaultValue={baseline?.id ?? ""} className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2">
                  <option value="">{tr("detail.review.none")}</option>
                  {analyses.map((analysis) => <option key={analysis.id} value={analysis.id}>{analysisLabel(analysis, locale)}</option>)}
                </select>
              </label>
              <button type="submit" className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">{tr("detail.review.open")}</button>
            </form>
            {invalidSelection && <p role="status" className="mt-3 text-sm text-amber-300">{tr("detail.review.invalid")}</p>}
            {selected.id !== latest?.id && (
              <p className="mt-3 text-sm text-amber-300">
                {tr("detail.review.previous")} · <Link href={`/incidents/${incident.id}`} className="underline underline-offset-2">{tr("detail.review.backToLatest")}</Link>
              </p>
            )}
          </Card>
          {baseline && <AnalysisComparison baseline={baseline} current={selected} locale={locale} />}
          <AnalysisExport key={selected.id} analysis={selected} context={incident} locale={locale} />
          {workspaceId && (
            <ResponseWorkspace
              key={workspaceId}
              workspaceId={workspaceId}
              analysis={selected}
              context={{ id: incident.id, title: incident.title, service: incident.service }}
              persistenceAvailable
              locale={locale}
            />
          )}
          <div className="flex items-center justify-end">
            <EvaluateButton key={selected.id} analysisId={selected.id} />
          </div>
          <AnalysisCard a={selected} locale={locale} />
        </>
      )}

      {usedChunks.length > 0 && (
        <Card title={tr("detail.kb.title")}>
          <ul className="space-y-3">
            {usedChunks.map((u) => (
              <li key={u.chunk_id} className="border-l-2 border-emerald-500/40 pl-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">[{u.rank + 1}]</span>
                  <span className="text-xs px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300">{u.kb_chunks.kb_documents.kind}</span>
                  <span className="font-medium text-neutral-200 truncate">{u.kb_chunks.kb_documents.title || u.kb_chunks.kb_documents.source_path}</span>
                  <span className="ml-auto text-xs text-neutral-500">{(u.similarity * 100).toFixed(0)}%</span>
                </div>
                <pre className="text-xs text-neutral-400 mt-1 whitespace-pre-wrap line-clamp-4">{u.kb_chunks.text}</pre>
              </li>
            ))}
          </ul>
        </Card>
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

    </Shell>
  );
}

function analysisLabel(analysis: AnalysisRow, locale: "en" | "zh") {
  const date = new Date(analysis.created_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC" });
  return [analysis.prompt_version, analysis.output_language, analysis.severity, `${date} UTC`, analysis.id.slice(0, 8)].filter(Boolean).join(" · ");
}

function Shell({ children }: { children: React.ReactNode }) {
  // Use flex-col instead of space-y-* so every direct child stretches to
  // full container width by default (align-items: stretch). Eliminates any
  // chance of a child collapsing to its content width.
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
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

function AnalysisCard({ a, locale }: { a: AnalysisRow; locale: "en" | "zh" }) {
  const tr = (k: string) => t(locale, k);
  const content = normalizeAnalysisContent(a);
  const rcs = content.root_causes;
  const checklist = content.investigation_checklist;
  const mitigation = content.mitigation_plan;
  const follow = content.follow_ups;
  // flex+w-full instead of bare `grid gap-4`: eliminates any chance that
  // Tailwind v4's grid without explicit cols sizes children to content,
  // and uses gap-6 to match the page-level `space-y-6` so the AI sub-cards
  // have the same visual rhythm as the raw-context card above them.
  return (
    <div className="flex flex-col gap-6 w-full">
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
