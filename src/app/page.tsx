"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/schema";

const SAMPLE = `Time: 14:02 UTC. payment-svc p99 latency jumped from 120ms to 4.8s.
Error rate climbed from 0.1% to 12% (mostly 500s).
Logs show: "connection refused" from payment-svc -> postgres-primary.
Postgres CPU normal (35%), but active_connections = 500 / 500.
Recent change: payment-svc v2.41 deployed 13:50 UTC, added a new batch job.
On-call notes: customers reporting failed checkouts; CS queue spiking.`;

export default function Home() {
  const [raw, setRaw] = useState(SAMPLE);
  const [service, setService] = useState("payment-svc");
  const [symptoms, setSymptoms] = useState("p99 latency 4.8s, 12% 500s, customer checkouts failing");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [meta, setMeta] = useState<{ latency_ms: number; model: string; prompt_version: string } | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    setMeta(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_context: raw, service, symptoms, persist: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "request failed");
      setResult(data.analysis);
      setMeta({ latency_ms: data.latency_ms, model: data.model, prompt_version: data.prompt_version });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">AI Reliability Copilot</h1>
          <p className="text-neutral-400 mt-2">
            Paste an incident. Get a structured 9-section response: summary, severity, root cause hypotheses, investigation checklist, mitigation plan, customer impact, postmortem draft, follow-ups.
          </p>
        </header>

        <section className="grid gap-4 bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">Affected service</span>
              <input
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">Symptoms</span>
              <input
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">Raw context (logs, metrics, on-call notes)</span>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={10}
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 font-mono text-sm"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={run}
              disabled={loading || raw.length < 20}
              className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-md"
            >
              {loading ? "Analyzing..." : "Analyze incident"}
            </button>
            {meta && (
              <span className="text-xs text-neutral-500">
                {meta.model} · prompt {meta.prompt_version} · {meta.latency_ms}ms
              </span>
            )}
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </section>

        {result && <AnalysisView a={result} />}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function SeverityBadge({ s }: { s: string }) {
  const color =
    s === "SEV1" ? "bg-red-500/20 text-red-300 border-red-500/40" :
    s === "SEV2" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  return <span className={`inline-block text-xs px-2 py-1 rounded border ${color}`}>{s}</span>;
}

function AnalysisView({ a }: { a: Analysis }) {
  return (
    <div className="grid gap-4">
      <Section title="Summary">
        <div className="flex items-start gap-3">
          <SeverityBadge s={a.severity} />
          <p className="text-neutral-200">{a.summary}</p>
        </div>
        <p className="text-sm text-neutral-400 mt-2">Severity reasoning: {a.severity_reasoning}</p>
      </Section>

      <Section title="Root cause hypotheses">
        <ul className="space-y-3">
          {a.root_causes.map((r, i) => (
            <li key={i} className="border-l-2 border-indigo-500/50 pl-3">
              <div className="flex gap-2 items-center">
                <span className="text-xs uppercase text-neutral-500">{r.likelihood}</span>
                <span className="font-medium">{r.hypothesis}</span>
              </div>
              <p className="text-sm text-neutral-400 mt-1">Evidence: {r.evidence}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Investigation checklist">
        <ol className="space-y-3 list-decimal list-inside">
          {a.investigation_checklist.map((s, i) => (
            <li key={i}>
              <span className="font-medium">{s.step}</span>
              <pre className="mt-1 bg-neutral-950 border border-neutral-800 rounded p-2 text-xs overflow-x-auto"><code>{s.command}</code></pre>
              <p className="text-xs text-neutral-400 mt-1">Expected: {s.expected}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Mitigation plan">
        <ul className="space-y-3">
          {a.mitigation_plan.map((m, i) => (
            <li key={i}>
              <p className="font-medium">{m.action}</p>
              <p className="text-xs text-amber-300/80">Risk: {m.risk}</p>
              <p className="text-xs text-neutral-400">Rollback: {m.rollback}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Customer impact">
        <p className="text-neutral-200 whitespace-pre-wrap">{a.customer_impact}</p>
      </Section>

      <Section title="Postmortem draft">
        <pre className="whitespace-pre-wrap text-sm text-neutral-300 font-mono">{a.postmortem_draft}</pre>
      </Section>

      <Section title="Follow-ups">
        <ul className="space-y-2">
          {a.follow_ups.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">{f.priority}</span>
              <span className="text-neutral-200">{f.item}</span>
              <span className="text-neutral-500">— {f.owner_role}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
