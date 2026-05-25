import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  tool_name: string;
  ok: boolean;
  latency_ms: number | null;
  error: string | null;
  client_ip: string | null;
  input_summary: string | null;
  result_size_bytes: number | null;
  created_at: string;
};

export default async function McpUsagePage() {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);

  if (!hasSupabase()) {
    return <Shell title={tr("mcp.title")}><p className="text-neutral-400">{tr("incidents.dbMissing.body")}</p></Shell>;
  }

  const sb = supabaseAdmin();
  // 7-day window — `Date.now()` is intentionally impure in this server component
  // because the whole page is `force-dynamic` and we WANT a fresh wall-clock per request.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows7d } = await sb
    .from("mcp_tool_calls")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  const rows = (rows7d ?? []) as Row[];

  // Aggregate by tool
  type ToolAgg = { count: number; errors: number; latencySum: number; sizeSum: number; latencyMax: number };
  const byTool = new Map<string, ToolAgg>();
  const ips = new Set<string>();
  for (const r of rows) {
    const agg = byTool.get(r.tool_name) ?? { count: 0, errors: 0, latencySum: 0, sizeSum: 0, latencyMax: 0 };
    agg.count += 1;
    if (!r.ok) agg.errors += 1;
    agg.latencySum += r.latency_ms ?? 0;
    agg.sizeSum += r.result_size_bytes ?? 0;
    if ((r.latency_ms ?? 0) > agg.latencyMax) agg.latencyMax = r.latency_ms ?? 0;
    byTool.set(r.tool_name, agg);
    if (r.client_ip) ips.add(r.client_ip);
  }

  const totalCount = rows.length;
  const errorCount = rows.filter((r) => !r.ok).length;
  const avgLatency = totalCount ? rows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / totalCount : 0;
  const errorRate = totalCount ? (errorCount / totalCount) * 100 : 0;

  const failures = rows.filter((r) => !r.ok).slice(0, 10);

  return (
    <Shell title={tr("mcp.title")}>
      <p className="text-neutral-400 text-sm">{tr("mcp.subtitle")}</p>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label={tr("mcp.totalCalls")} value={String(totalCount)} highlight />
        <Stat label={tr("mcp.errorRate")} value={`${errorRate.toFixed(1)}%`} tone={errorRate > 5 ? "warn" : "ok"} />
        <Stat label={tr("mcp.avgLatency")} value={`${Math.round(avgLatency)}ms`} />
        <Stat label={tr("mcp.uniqueIps")} value={String(ips.size)} />
      </section>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">{tr("mcp.byTool")}</h2>
        {byTool.size === 0 ? (
          <p className="text-neutral-400 text-sm">{tr("mcp.noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-2 pr-4">tool</th>
                  <th className="py-2 pr-4">calls</th>
                  <th className="py-2 pr-4">errors</th>
                  <th className="py-2 pr-4">avg ms</th>
                  <th className="py-2 pr-4">max ms</th>
                  <th className="py-2 pr-4">avg bytes</th>
                </tr>
              </thead>
              <tbody>
                {[...byTool.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, a]) => (
                  <tr key={name} className="border-t border-neutral-800">
                    <td className="py-2 pr-4 font-mono">{name}</td>
                    <td className="py-2 pr-4 font-bold text-indigo-300">{a.count}</td>
                    <td className={`py-2 pr-4 ${a.errors > 0 ? "text-amber-300" : "text-neutral-500"}`}>{a.errors}</td>
                    <td className="py-2 pr-4">{Math.round(a.latencySum / a.count)}</td>
                    <td className="py-2 pr-4">{a.latencyMax}</td>
                    <td className="py-2 pr-4">{Math.round(a.sizeSum / a.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {failures.length > 0 && (
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-3">{tr("mcp.recentFailures")}</h2>
          <ul className="divide-y divide-neutral-800 text-sm">
            {failures.map((f) => (
              <li key={f.id} className="py-2">
                <div className="flex gap-3 items-center flex-wrap">
                  <span className="font-mono text-neutral-300">{f.tool_name}</span>
                  <span className="text-xs text-neutral-500">{new Date(f.created_at).toLocaleString()}</span>
                  {f.client_ip && <span className="text-xs text-neutral-500">{f.client_ip}</span>}
                </div>
                {f.error && <p className="text-xs text-amber-300/80 mt-1 font-mono">{f.error}</p>}
                {f.input_summary && <p className="text-xs text-neutral-500 mt-0.5">in: {f.input_summary}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

function Stat({ label, value, highlight, tone = "ok" }: { label: string; value: string; highlight?: boolean; tone?: "ok" | "warn" }) {
  const color = highlight ? "text-indigo-300" : tone === "warn" ? "text-amber-300" : "text-neutral-100";
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={`font-bold ${color} text-lg mt-1`}>{value}</p>
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
