import Link from "next/link";
import { listIncidents, hasSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  if (!hasSupabase()) {
    return (
      <PageShell>
        <EmptyState
          title="Database not configured"
          body="Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to see saved incidents."
        />
      </PageShell>
    );
  }

  const incidents = await listIncidents();
  return (
    <PageShell>
      {incidents.length === 0 ? (
        <EmptyState title="No incidents yet" body="Submit one on the New page to see it here." />
      ) : (
        <ul className="divide-y divide-neutral-800 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {incidents.map((i) => (
            <li key={i.id}>
              <Link href={`/incidents/${i.id}`} className="block px-5 py-4 hover:bg-neutral-800/50">
                <div className="flex justify-between items-baseline gap-4">
                  <span className="font-medium">{i.title || i.service || "Untitled incident"}</span>
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

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">Incidents</h1>
          <nav className="flex gap-3 text-sm text-neutral-400">
            <Link className="hover:text-white" href="/">New</Link>
            <Link className="hover:text-white" href="/incidents">Incidents</Link>
            <Link className="hover:text-white" href="/scenarios">Scenarios</Link>
            <Link className="hover:text-white" href="/evals">Evals</Link>
          </nav>
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
