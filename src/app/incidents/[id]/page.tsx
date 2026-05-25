import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getIncidentWithAnalyses, hasSupabase, type AnalysisRow } from "@/lib/db";
import { CopyButton } from "@/components/CopyButton";
import { ReRunButton } from "@/components/ReRunButton";
import { EvaluateButton } from "@/components/EvaluateButton";

export const dynamic = "force-dynamic";

export default async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return <Shell><p className="text-neutral-400">Supabase not configured.</p></Shell>;
  }
  const data = await getIncidentWithAnalyses(id);
  if (!data) return notFound();
  const { incident, analyses } = data;
  const latest = analyses[0];

  return (
    <Shell>
      <header>
        <Link href="/incidents" className="text-sm text-neutral-400 hover:text-white">← All incidents</Link>
        <h1 className="text-2xl font-bold mt-2">{incident.title || incident.service || "Untitled"}</h1>
        <p className="text-sm text-neutral-500 mt-1">
          {incident.service && <span className="mr-3">service: <span className="text-neutral-300">{incident.service}</span></span>}
          <span>created: {new Date(incident.created_at).toLocaleString()}</span>
        </p>
      </header>

      <Card title="Raw incident context">
        <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono">{incident.raw_context}</pre>
        <div className="mt-3">
          <ReRunButton incidentId={incident.id} />
        </div>
      </Card>

      {!latest && <p className="text-neutral-400">No analyses yet.</p>}
      {latest && (
        <>
          <div className="flex items-center justify-end">
            <EvaluateButton analysisId={latest.id} />
          </div>
          <AnalysisCard a={latest} />
        </>
      )}

      {analyses.length > 1 && (
        <details className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-sm">
          <summary className="cursor-pointer text-neutral-300">{analyses.length - 1} earlier analysis version(s)</summary>
          <ul className="mt-3 space-y-2 text-neutral-400">
            {analyses.slice(1).map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded border border-neutral-700">{a.prompt_version}</span>
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
        <nav className="flex gap-3 text-sm text-neutral-400 justify-end">
          <Link className="hover:text-white" href="/">New</Link>
          <Link className="hover:text-white" href="/incidents">Incidents</Link>
          <Link className="hover:text-white" href="/scenarios">Scenarios</Link>
          <Link className="hover:text-white" href="/evals">Evals</Link>
        </nav>
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

function AnalysisCard({ a }: { a: AnalysisRow }) {
  const rcs = asArr<RootCause>(a.root_causes);
  const checklist = asArr<Step>(a.investigation_checklist);
  const mitigation = asArr<Mitig>(a.mitigation_plan);
  const follow = asArr<Follow>(a.follow_ups);
  return (
    <div className="grid gap-4">
      <Card title="Summary">
        <div className="flex items-start gap-3">
          <SeverityBadge s={a.severity} />
          <p className="text-neutral-200">{a.summary}</p>
        </div>
        {a.severity_reasoning && (
          <p className="text-sm text-neutral-400 mt-2">Severity reasoning: {a.severity_reasoning}</p>
        )}
        <p className="text-xs text-neutral-500 mt-3">
          {a.model} · prompt {a.prompt_version} · {a.latency_ms}ms
        </p>
      </Card>
      {rcs.length > 0 && (
        <Card title="Root cause hypotheses">
          <ul className="space-y-3">
            {rcs.map((r, i) => (
              <li key={i} className="border-l-2 border-indigo-500/50 pl-3">
                <div className="flex gap-2 items-center">
                  <span className="text-xs uppercase text-neutral-500">{r.likelihood}</span>
                  <span className="font-medium">{r.hypothesis}</span>
                </div>
                <p className="text-sm text-neutral-400 mt-1">Evidence: {r.evidence}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {checklist.length > 0 && (
        <Card title="Investigation checklist">
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
                <p className="text-xs text-neutral-400 mt-1">Expected: {s.expected}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {mitigation.length > 0 && (
        <Card title="Mitigation plan">
          <ul className="space-y-3">
            {mitigation.map((m, i) => (
              <li key={i}>
                <p className="font-medium">{m.action}</p>
                <p className="text-xs text-amber-300/80">Risk: {m.risk}</p>
                <p className="text-xs text-neutral-400">Rollback: {m.rollback}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a.customer_impact && <Card title="Customer impact"><p className="text-neutral-200 whitespace-pre-wrap">{a.customer_impact}</p></Card>}
      {a.postmortem_draft && (
        <Card title="Postmortem draft">
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-li:text-neutral-300 prose-strong:text-neutral-100">
            <ReactMarkdown>{a.postmortem_draft}</ReactMarkdown>
          </div>
        </Card>
      )}
      {follow.length > 0 && (
        <Card title="Follow-ups">
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
