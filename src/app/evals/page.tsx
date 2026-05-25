import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { RUBRIC_DEFINITIONS, type RubricDim } from "@/lib/eval/rubric";

export const dynamic = "force-dynamic";

type EvalRow = {
  id: string;
  analysis_id: string;
  rubric_version: string;
  scores: Record<RubricDim, { score: number; reasoning: string }> & { overall_notes?: string };
  overall: number;
  judge_model: string;
  judge_notes: string | null;
  created_at: string;
};

type AnalysisLite = {
  id: string;
  incident_id: string;
  prompt_version: string | null;
  severity: string | null;
  model: string | null;
};

type IncidentLite = {
  id: string;
  title: string | null;
};

export default async function EvalsPage() {
  if (!hasSupabase()) {
    return (
      <Shell>
        <p className="text-neutral-400">Supabase not configured. Run <code>npm run evals:run</code> after setting env vars.</p>
      </Shell>
    );
  }

  const sb = supabaseAdmin();
  const { data: evals } = await sb.from("evaluations").select("*").order("created_at", { ascending: false }).limit(200);
  const rows = (evals ?? []) as EvalRow[];
  const analysisIds = [...new Set(rows.map((r) => r.analysis_id))];
  const { data: analyses } = analysisIds.length
    ? await sb.from("analyses").select("id, incident_id, prompt_version, severity, model").in("id", analysisIds)
    : { data: [] };
  const aMap = new Map<string, AnalysisLite>();
  for (const a of (analyses ?? []) as AnalysisLite[]) aMap.set(a.id, a);

  const incidentIds = [...new Set((analyses ?? []).map((a: AnalysisLite) => a.incident_id))];
  const { data: incidents } = incidentIds.length
    ? await sb.from("incidents").select("id, title").in("id", incidentIds)
    : { data: [] };
  const iMap = new Map<string, IncidentLite>();
  for (const i of (incidents ?? []) as IncidentLite[]) iMap.set(i.id, i);

  // Aggregate by prompt_version
  type Agg = { count: number; sum: number; dimSums: Record<RubricDim, number> };
  const dims: RubricDim[] = ["specificity", "safety", "actionability", "domain_correctness", "completeness"];
  const byVersion = new Map<string, Agg>();
  for (const r of rows) {
    const a = aMap.get(r.analysis_id);
    const v = a?.prompt_version ?? "unknown";
    const agg = byVersion.get(v) ?? { count: 0, sum: 0, dimSums: { specificity: 0, safety: 0, actionability: 0, domain_correctness: 0, completeness: 0 } };
    agg.count += 1;
    agg.sum += Number(r.overall);
    for (const d of dims) agg.dimSums[d] += r.scores[d]?.score ?? 0;
    byVersion.set(v, agg);
  }

  return (
    <Shell>
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Evaluations</h1>
          <p className="text-neutral-400 text-sm mt-1">Rubric v1 · 5 dims · LLM-as-judge (DeepSeek). Each row is an analysis scored 1–5 per dim.</p>
        </div>
        <nav className="flex gap-3 text-sm text-neutral-400">
          <Link className="hover:text-white" href="/">New</Link>
          <Link className="hover:text-white" href="/incidents">Incidents</Link>
          <Link className="hover:text-white" href="/scenarios">Scenarios</Link>
          <Link className="hover:text-white" href="/evals">Evals</Link>
        </nav>
      </header>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">Average by prompt version</h2>
        {byVersion.size === 0 ? (
          <p className="text-neutral-400 text-sm">No evaluations yet. Run <code className="text-neutral-200">npm run evals:run</code>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-2 pr-4">version</th>
                  <th className="py-2 pr-4">n</th>
                  <th className="py-2 pr-4">overall</th>
                  {dims.map((d) => (
                    <th key={d} className="py-2 pr-4">{RUBRIC_DEFINITIONS[d].title.split(" ")[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byVersion.entries()].sort().map(([v, agg]) => (
                  <tr key={v} className="border-t border-neutral-800">
                    <td className="py-2 pr-4 font-mono">{v}</td>
                    <td className="py-2 pr-4">{agg.count}</td>
                    <td className="py-2 pr-4 font-bold text-indigo-300">{(agg.sum / agg.count).toFixed(2)}</td>
                    {dims.map((d) => (
                      <td key={d} className="py-2 pr-4">{(agg.dimSums[d] / agg.count).toFixed(2)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">Individual evaluations ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-neutral-400 text-sm">No evaluations yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {rows.map((r) => {
              const a = aMap.get(r.analysis_id);
              const inc = a ? iMap.get(a.incident_id) : null;
              return (
                <li key={r.id} className="py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs px-1.5 py-0.5 rounded border border-neutral-700">{a?.prompt_version ?? "?"}</span>
                    <span className="font-bold text-indigo-300">{Number(r.overall).toFixed(2)}</span>
                    {inc && (
                      <Link href={`/incidents/${inc.id}`} className="text-sm text-neutral-200 hover:underline">
                        {inc.title || inc.id.slice(0, 8)}
                      </Link>
                    )}
                    <span className="ml-auto text-xs text-neutral-500">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 flex gap-2 flex-wrap text-xs">
                    {dims.map((d) => (
                      <span key={d} className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">
                        {RUBRIC_DEFINITIONS[d].title.split(" ")[0]}: {r.scores[d]?.score}
                      </span>
                    ))}
                  </div>
                  {r.judge_notes && <p className="text-xs text-neutral-400 mt-2">{r.judge_notes}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">{children}</div>
    </main>
  );
}
