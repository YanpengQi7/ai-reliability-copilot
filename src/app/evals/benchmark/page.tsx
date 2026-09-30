import Link from "next/link";
import type { buildReport } from "@/lib/eval/report";
import exportedReport from "../../../../evals/public/latest.json";

const report = exportedReport as ReturnType<typeof buildReport> & { execution: string; versions: Record<string, string> };
const percent = (value: number | null) => value === null ? "Not available" : `${(value * 100).toFixed(1)}%`;

export default function BenchmarkPage() {
  const mock = report.execution === "mock";
  return (
    <main className="mx-auto max-w-5xl space-y-7 px-6 py-10 text-neutral-100">
      <header className="flex items-center justify-between gap-4">
        <div><h1 className="text-3xl font-bold">Evidence benchmark</h1><p className="mt-2 text-neutral-400">Compare diagnosis outcomes, evidence, and cost under a recorded experiment.</p></div>
        <Link href="/evals" className="text-indigo-300 underline">Evaluation history</Link>
      </header>
      <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200">
        {mock ? "Offline pipeline demonstration — these are mock responses, not model quality results." : "Exploratory results, not a release qualification. These synthetic pilot results have limited coverage; labels and judge calibration still need independent review."}
        <p className="mt-2 text-sm">Release decision: {report.gate}. {report.draft_labels ? "Labels still require independent human review." : "Labels reviewed."}</p>
      </div>
      <section className="rounded-xl border border-neutral-800 p-5">
        <h2 className="mb-3 text-lg font-semibold">Release criteria</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">{report.gate_reasons.map(reason => <li key={reason}>{reason.replaceAll("_", " ")}</li>)}</ul>
        <p className="mt-3 text-sm text-neutral-400">Independent incident families: {report.comparison?.families ?? "No paired comparison"}. Judge calibrated: {report.calibrated ? "yes" : "no"}.</p>
      </section>
      <section className="overflow-x-auto rounded-xl border border-neutral-800 p-5">
        <h2 className="mb-4 text-lg font-semibold">Every planned trial stays in the denominator</h2>
        <table className="w-full text-left text-sm">
          <thead><tr className="text-neutral-400"><th className="p-2">Approach</th><th className="p-2">Planned</th><th className="p-2">Assessed</th><th className="p-2">Checks passed</th><th className="p-2">Required evidence retrieved</th><th className="p-2">All attempts p95</th><th className="p-2">Cost / success</th></tr></thead>
          <tbody>{Object.entries(report.modes).map(([mode, s]) => <tr key={mode} className="border-t border-neutral-800"><td className="p-2">{mode}</td><td className="p-2">{s.planned}</td><td className="p-2">{s.assessed}</td><td className="p-2">{mock ? "Not measured" : `${s.succeeded}/${s.planned}`}</td><td className="p-2">{s.evidence_coverage === null ? "Not applicable" : `${Math.round(s.evidence_coverage * 100)}%`}</td><td className="p-2">{s.attempted_p95_ms === null ? "Not available" : `${(s.attempted_p95_ms / 1000).toFixed(1)}s`}</td><td className="p-2">{s.cost_per_success === null ? "Not available" : `$${Number(s.cost_per_success).toFixed(5)}`}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="overflow-x-auto rounded-xl border border-neutral-800 p-5">
        <h2 className="mb-3 text-lg font-semibold">Reliability across incident families</h2>
        <p className="mb-4 text-sm text-neutral-400">Each incident family receives equal weight, so many similar cases cannot hide failures in other incident types. Both the overall and family success rates must meet the release threshold.</p>
        <table className="w-full text-left text-sm">
          <thead><tr className="text-neutral-400"><th scope="col" className="p-2">Approach</th><th scope="col" className="p-2">Overall success</th><th scope="col" className="p-2">Family success</th><th scope="col" className="p-2">Family coverage</th><th scope="col" className="p-2">Families with all trials failing</th><th scope="col" className="p-2">Incomplete families</th></tr></thead>
          <tbody>{Object.entries(report.modes).map(([mode, s]) => <tr key={mode} className="border-t border-neutral-800"><th scope="row" className="p-2 font-normal">{mode}</th><td className="p-2">{mock ? "Not measured" : percent(s.success_rate)}</td><td className="p-2">{mock ? "Not measured" : percent(s.family_success_rate)}</td><td className="p-2">{percent(s.family_coverage)}</td><td className="p-2">{mock ? "Not measured" : `${s.fully_failed_families}/${s.families}`}</td><td className="p-2">{s.incomplete_families}</td></tr>)}</tbody>
        </table>
        <p className="mt-3 text-sm text-neutral-400">Success rates include all planned trials. Missing grades reduce coverage and remain unresolved; they are not counted as assessed failures.</p>
        <div className="mt-4 space-y-3">{Object.entries(report.modes).map(([mode, s]) => <details key={mode} className="rounded-lg border border-neutral-800 p-4"><summary className="cursor-pointer">{mode} · {s.families} incident families</summary><ul className="mt-3 space-y-3 text-sm text-neutral-400">{s.family_results.map(f => <li key={f.family}><span className="font-mono text-neutral-200">{f.family}</span>: {mock ? "quality not measured" : `${f.succeeded}/${f.planned} passed`}, {f.assessed}/{f.planned} assessed.<div>Cases: {f.case_ids.join(", ")}</div>{Object.keys(f.failure_reasons).length > 0 && <div>Failure reasons: {Object.entries(f.failure_reasons).map(([reason, count]) => `${reason.replaceAll("_", " ")} (${count})`).join(", ")}</div>}{Object.keys(f.unassessed_reasons).length > 0 && <div>Unresolved reasons: {Object.entries(f.unassessed_reasons).map(([reason, count]) => `${reason.replaceAll("_", " ")} (${count})`).join(", ")}</div>}</li>)}</ul></details>)}</div>
      </section>
      <section className="rounded-xl border border-neutral-800 p-5">
        <h2 className="mb-3 text-lg font-semibold">Experiment identity</h2>
        <dl className="grid gap-2 text-sm"><div>Run: {report.run_id}</div><div>Investigation engine: {report.engine_version}</div><div>Generator: {report.versions.model}</div><div>Judge: {report.versions.judge}</div><div>Severity policy: {report.versions.policy}</div><div className="break-all text-neutral-400">Dataset: {report.versions.dataset}</div></dl>
        <p className="mt-4 text-sm text-neutral-400">Comparisons use paired incident families. Repeated runs and translations are not counted as independent incidents. Private run artifacts are never served here; this page uses an explicitly exported synthetic aggregate.</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cases requiring review</h2>
        {Object.entries(report.modes).map(([mode, s]) => <details key={mode} className="rounded-lg border border-neutral-800 p-4"><summary className="cursor-pointer">{mode} · {s.failures.length} unresolved outcomes</summary><ul className="mt-3 space-y-2 text-sm text-neutral-400">{s.failures.map(f => <li key={f.id}><span className="font-mono">{f.id}</span>: {f.reasons.join(", ")}</li>)}</ul></details>)}
      </section>
    </main>
  );
}
