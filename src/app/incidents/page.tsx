import { hasSupabase } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { IncidentArchive } from "@/components/IncidentArchive";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";
import { publicIncidentDataEnabled } from "@/lib/incidentAccess";
import { createDatabaseQuerySignal } from "@/lib/databaseDeadline";
import {
  archiveHref,
  encodeIncidentArchiveCursor,
  parseIncidentArchiveParams,
  type ArchiveSearchParams,
} from "@/lib/incidentArchive";
import { listIncidentArchivePage, type IncidentArchiveRow } from "@/lib/incidentArchiveQuery";

export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<ArchiveSearchParams> }) {
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
  const { filters, cursor, issues } = parseIncidentArchiveParams(await searchParams);
  let incidents: IncidentArchiveRow[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  if (!issues.length) {
    try {
      const page = await listIncidentArchivePage(filters, cursor, { abortSignal: createDatabaseQuerySignal() });
      incidents = page.incidents;
      nextCursor = page.nextCursor;
    } catch {
      failed = true;
    }
  }
  const retryHref = archiveHref(filters, !issues.length && cursor ? encodeIncidentArchiveCursor(cursor, filters) : undefined);
  return (
    <PageShell title={tr("incidents.title")}>
      <IncidentArchive filters={filters} issues={issues} incidents={incidents} nextCursor={nextCursor} isOlderPage={Boolean(cursor)} failed={failed} locale={locale} retryHref={retryHref} />
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
