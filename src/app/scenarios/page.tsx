import { SCENARIOS } from "@/lib/scenarios";
import { RunScenarioButton } from "@/components/RunScenarioButton";
import { Nav } from "@/components/Nav";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/messages";

export default async function ScenariosPage() {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{tr("scenarios.title")}</h1>
            <p className="text-neutral-400 text-sm mt-1">{tr("scenarios.subtitle")}</p>
          </div>
          <Nav />
        </header>

        <ul className="grid gap-4">
          {SCENARIOS.map((s) => (
            <li key={s.slug} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">{s.category}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400">{s.service}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {tr("scenarios.expected")} {s.expected_severity}
                    </span>
                  </div>
                  <h3 className="font-medium">{s.title}</h3>
                  <p className="text-sm text-neutral-400 mt-1">{s.symptoms}</p>
                </div>
                <RunScenarioButton slug={s.slug} />
              </div>
              <details className="mt-3 text-xs">
                <summary className="text-neutral-500 cursor-pointer">{tr("scenarios.showContext")}</summary>
                <pre className="mt-2 text-neutral-400 font-mono whitespace-pre-wrap p-2 bg-neutral-950 border border-neutral-800 rounded">{s.context}</pre>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
