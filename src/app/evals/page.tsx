import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { RUBRIC_DEFINITIONS, type RubricDim } from "@/lib/eval/rubric";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";

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
  output_language: string | null;
  severity: string | null;
  model: string | null;
};

type IncidentLite = {
  id: string;
  title: string | null;
};

export default async function EvalsPage() {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  if (!hasSupabase()) {
    return (
      <Shell>
        <p className="text-neutral-400">{tr("incidents.dbMissing.body")}</p>
      </Shell>
    );
  }

  const sb = supabaseAdmin();
  const { data: evals } = await sb.from("evaluations").select("*").order("created_at", { ascending: false }).limit(200);
  const rows = (evals ?? []) as EvalRow[];
  const analysisIds = [...new Set(rows.map((r) => r.analysis_id))];
  const { data: analyses } = analysisIds.length
    ? await sb.from("analyses").select("id, incident_id, prompt_version, output_language, severity, model").in("id", analysisIds)
    : { data: [] };
  const aMap = new Map<string, AnalysisLite>();
  for (const a of (analyses ?? []) as AnalysisLite[]) aMap.set(a.id, a);

  const incidentIds = [...new Set((analyses ?? []).map((a: AnalysisLite) => a.incident_id))];
  const { data: incidents } = incidentIds.length
    ? await sb.from("incidents").select("id, title").in("id", incidentIds)
    : { data: [] };
  const iMap = new Map<string, IncidentLite>();
  for (const i of (incidents ?? []) as IncidentLite[]) iMap.set(i.id, i);

  const dims: RubricDim[] = ["specificity", "safety", "actionability", "domain_correctness", "completeness"];
  const dimLabelKey: Record<RubricDim, string> = {
    specificity: "rubric.specificity",
    safety: "rubric.safety",
    actionability: "rubric.actionability",
    domain_correctness: "rubric.domainCorrectness",
    completeness: "rubric.completeness",
  };

  type Agg = { count: number; sum: number; dimSums: Record<RubricDim, number> };
  const newAgg = (): Agg => ({ count: 0, sum: 0, dimSums: { specificity: 0, safety: 0, actionability: 0, domain_correctness: 0, completeness: 0 } });

  // Aggregate by prompt_version
  const byVersion = new Map<string, Agg>();
  // Aggregate by output_language
  const byLanguage = new Map<string, Agg>();
  for (const r of rows) {
    const a = aMap.get(r.analysis_id);
    const v = a?.prompt_version ?? "unknown";
    const l = a?.output_language ?? "en";
    for (const [map, key] of [[byVersion, v], [byLanguage, l]] as const) {
      const agg = map.get(key) ?? newAgg();
      agg.count += 1;
      agg.sum += Number(r.overall);
      for (const d of dims) agg.dimSums[d] += r.scores[d]?.score ?? 0;
      map.set(key, agg);
    }
  }

  return (
    <Shell>
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{tr("evals.title")}</h1>
          <p className="text-neutral-400 text-sm mt-1">{tr("evals.subtitle")}</p>
        </div>
        <Nav />
      </header>

      <AggSection title={tr("evals.byVersion")} agg={byVersion} dims={dims} dimLabelKey={dimLabelKey} locale={locale} />
      <AggSection title={tr("evals.byLanguage")} agg={byLanguage} dims={dims} dimLabelKey={dimLabelKey} locale={locale} />

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">{tr("evals.individual")} ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-neutral-400 text-sm">{tr("evals.runHint")}</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {rows.map((r) => {
              const a = aMap.get(r.analysis_id);
              const inc = a ? iMap.get(a.incident_id) : null;
              return (
                <li key={r.id} className="py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs px-1.5 py-0.5 rounded border border-neutral-700">{a?.prompt_version ?? "?"}</span>
                    {a?.output_language && (
                      <span className="text-xs px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300">{a.output_language}</span>
                    )}
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
                        {t(locale, dimLabelKey[d])}: {r.scores[d]?.score}
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

function AggSection({
  title,
  agg,
  dims,
  dimLabelKey,
  locale,
}: {
  title: string;
  agg: Map<string, { count: number; sum: number; dimSums: Record<RubricDim, number> }>;
  dims: RubricDim[];
  dimLabelKey: Record<RubricDim, string>;
  locale: "en" | "zh";
}) {
  return (
    <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {agg.size === 0 ? (
        <p className="text-neutral-400 text-sm">{t(locale, "evals.runHint")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-2 pr-4">key</th>
                <th className="py-2 pr-4">n</th>
                <th className="py-2 pr-4">overall</th>
                {dims.map((d) => (
                  <th key={d} className="py-2 pr-4">{t(locale, dimLabelKey[d])}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...agg.entries()].sort().map(([key, a]) => (
                <tr key={key} className="border-t border-neutral-800">
                  <td className="py-2 pr-4 font-mono">{key}</td>
                  <td className="py-2 pr-4">{a.count}</td>
                  <td className="py-2 pr-4 font-bold text-indigo-300">{(a.sum / a.count).toFixed(2)}</td>
                  {dims.map((d) => (
                    <td key={d} className="py-2 pr-4">{(a.dimSums[d] / a.count).toFixed(2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">{children}</div>
    </main>
  );
}
