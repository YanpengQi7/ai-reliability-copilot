import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";
import { publicIncidentDataEnabled } from "@/lib/incidentAccess";
import { PrivateDataNotice } from "@/components/PrivateDataNotice";
import { createDatabaseQuerySignal } from "@/lib/databaseDeadline";

export const dynamic = "force-dynamic";

type DocRow = { id: string; source_path: string; kind: string; title: string | null; updated_at: string };

export default async function KbPage() {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);

  if (!publicIncidentDataEnabled()) {
    return <Shell title={tr("kb.title")}><PrivateDataNotice title={tr("privateData.title")} body={tr("privateData.body")} /></Shell>;
  }

  if (!hasSupabase()) {
    return <Shell title={tr("kb.title")}><p className="text-neutral-400">{tr("incidents.dbMissing.body")}</p></Shell>;
  }

  const sb = supabaseAdmin();
  const databaseSignal = createDatabaseQuerySignal();
  const { data: docs, error: docsError } = await sb.from("kb_documents").select("id, source_path, kind, title, updated_at").order("updated_at", { ascending: false }).abortSignal(databaseSignal);
  if (docsError) throw docsError;
  const { count: chunkCount, error: chunkError } = await sb.from("kb_chunks").select("*", { count: "exact", head: true }).abortSignal(databaseSignal);
  if (chunkError) throw chunkError;
  const { count: embeddedCount, error: embeddedError } = await sb.from("kb_chunks").select("*", { count: "exact", head: true }).not("embedding", "is", null).abortSignal(databaseSignal);
  if (embeddedError) throw embeddedError;

  const documents = (docs ?? []) as DocRow[];

  return (
    <Shell title={tr("kb.title")}>
      <p className="text-neutral-400 text-sm">{tr("kb.subtitle")}</p>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <div className="grid grid-cols-3 gap-4">
          <Stat label={tr("kb.totalDocs")} value={String(documents.length)} />
          <Stat label={tr("kb.totalChunks")} value={String(chunkCount ?? 0)} />
          <Stat label={tr("kb.totalEmbedded")} value={String(embeddedCount ?? 0)} sub={embeddedCount === 0 ? "set OPENAI_API_KEY to enable" : undefined} />
        </div>
      </section>

      {documents.length === 0 ? (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center">
          <p className="text-neutral-400 text-sm">{tr("kb.empty")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-800 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {documents.map((d) => (
            <li key={d.id} className="px-5 py-3 flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded border ${kindColor(d.kind)}`}>{d.kind}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neutral-200 truncate">{d.title || d.source_path}</p>
                <p className="text-xs text-neutral-500 truncate">{d.source_path}</p>
              </div>
              <span className="text-xs text-neutral-500 shrink-0">{new Date(d.updated_at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case "runbook":      return "bg-indigo-500/15 text-indigo-300 border-indigo-500/30";
    case "postmortem":   return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "service":      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "architecture": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default:             return "bg-neutral-700/40 text-neutral-300 border-neutral-700";
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  // Inner stat tile — sits inside a parent card, so use the darker bg + smaller padding
  // to read as "highlighted value" rather than "another card".
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="font-bold text-neutral-100 text-lg mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-500 mt-1">{sub}</p>}
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">{title}</h1>
          <Nav />
        </header>
        {children}
      </div>
    </main>
  );
}
