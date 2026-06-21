import Link from "next/link";
import { listIncidents, hasSupabase } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";
import { publicIncidentDataEnabled } from "@/lib/incidentAccess";
import { createDatabaseQuerySignal } from "@/lib/databaseDeadline";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  if (!publicIncidentDataEnabled()) {
    return (
      <PageShell title={tr("incidents.title")}>
        <EmptyState title={tr("incidents.private.title")} body={tr("incidents.private.body")} />
      </PageShell>
    );
  }
  if (!hasSupabase()) {
    return (
      <PageShell title={tr("incidents.title")}>
        <EmptyState title={tr("incidents.dbMissing.title")} body={tr("incidents.dbMissing.body")} />
      </PageShell>
    );
  }
  const incidents = await listIncidents(50, { abortSignal: createDatabaseQuerySignal() });
  return (
    <PageShell title={tr("incidents.title")}>
      {incidents.length === 0 ? (
        <EmptyState title={tr("incidents.empty.title")} body={tr("incidents.empty.body")} />
      ) : (
        <ul className="divide-y divide-neutral-800 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {incidents.map((i) => (
            <li key={i.id}>
              <Link href={`/incidents/${i.id}`} className="block px-5 py-4 hover:bg-neutral-800/50">
                <div className="flex justify-between items-baseline gap-4">
                  <span className="font-medium">{i.title || i.service || tr("incidents.untitled")}</span>
                  <span className="text-xs text-neutral-500">{new Date(i.created_at).toLocaleString()}</span>
                </div>
                {i.symptoms && <p className="text-sm text-neutral-400 mt-1 line-clamp-2">{i.symptoms}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-neutral-400 mt-2 text-sm">{body}</p>
    </div>
  );
}
