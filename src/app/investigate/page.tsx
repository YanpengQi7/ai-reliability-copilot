"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Nav } from "@/components/Nav";
import type { Analysis } from "@/lib/schema";
import { readApiError } from "@/lib/http";

// ── Types mirrored from src/lib/agent/types.ts (client-safe, no server imports) ──
type TraceStep = {
  index: number;
  tool: string;
  input: Record<string, unknown>;
  status: "ok" | "refused" | "error" | "empty";
  observation: string;
  reason?: string;
  latency_ms: number;
};
type InvestigationResult = {
  analysis: Analysis;
  trace: TraceStep[];
  usage: { model_calls: number; tokens_in: number; tokens_out: number; cost_usd: number };
  steps: number;
  completed: boolean;
  stop_reason: string;
  language: "en" | "zh";
};

const SCENARIO_OPTIONS = [
  { slug: "db-connection-pool-exhausted", label: "DB connection pool exhaustion (payment-svc)" },
  { slug: "bad-deploy-memory-leak", label: "OOM crashloop after deploy (order-svc)" },
  { slug: "upstream-dependency-timeout", label: "Upstream gateway timeout cascade (checkout-svc)" },
  { slug: "dns-misconfiguration", label: "Regional 5xx after DNS change (api-gateway)" },
  { slug: "cache-stampede", label: "Cache stampede on Black Friday (catalog-svc)" },
];

const STATUS_STYLE: Record<TraceStep["status"], { icon: string; cls: string }> = {
  ok: { icon: "✓", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
  empty: { icon: "∅", cls: "text-neutral-400 border-neutral-600/40 bg-neutral-500/5" },
  refused: { icon: "⛔", cls: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
  error: { icon: "✗", cls: "text-red-400 border-red-500/30 bg-red-500/5" },
};

const SEV_STYLE: Record<string, string> = {
  SEV1: "bg-red-500/15 text-red-300 border-red-500/40",
  SEV2: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  SEV3: "bg-sky-500/15 text-sky-300 border-sky-500/40",
};

function TraceTimeline({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="flex flex-col gap-2">
      {trace.map((s) => {
        const st = STATUS_STYLE[s.status];
        const isOpen = open === s.index;
        return (
          <li key={s.index} className={`rounded-lg border ${st.cls} px-3 py-2`}>
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(isOpen ? null : s.index)}>
              <span className="font-mono text-xs opacity-60">{s.index}</span>
              <span className="text-base">{st.icon}</span>
              <span className="font-mono text-sm text-neutral-200">{s.tool}</span>
              <span className="font-mono text-xs text-neutral-500 truncate">{JSON.stringify(s.input)}</span>
              <span className="ml-auto text-xs uppercase tracking-wide opacity-60">{s.status}{s.reason ? ` · ${s.reason}` : ""}</span>
            </button>
            {isOpen && (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 text-xs text-neutral-300">{s.observation}</pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

function AnalysisView({ a }: { a: Analysis }) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Summary">
        <div className="mb-3 flex items-center gap-3">
          <span className={`rounded border px-2 py-0.5 text-sm font-bold ${SEV_STYLE[a.severity] ?? "border-neutral-600"}`}>{a.severity}</span>
          <span className="text-xs text-neutral-400">{a.severity_reasoning}</span>
        </div>
        <p className="text-sm text-neutral-200">{a.summary}</p>
      </Section>

      <Section title={`Root causes (${a.root_causes.length})`}>
        <ul className="flex flex-col gap-2">
          {a.root_causes.map((rc, i) => (
            <li key={i} className="text-sm">
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${rc.likelihood === "high" ? "bg-red-500/15 text-red-300" : rc.likelihood === "medium" ? "bg-amber-500/15 text-amber-300" : "bg-neutral-500/15 text-neutral-300"}`}>{rc.likelihood}</span>
              <span className="text-neutral-200">{rc.hypothesis}</span>
              <div className="mt-0.5 pl-1 text-xs text-neutral-500">evidence: {rc.evidence}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Investigation checklist (${a.investigation_checklist.length})`}>
        <ol className="flex flex-col gap-3">
          {a.investigation_checklist.map((step, i) => (
            <li key={i} className="text-sm">
              <div className="text-neutral-200">{i + 1}. {step.step}</div>
              <pre className="my-1 overflow-x-auto rounded bg-black/50 px-2 py-1 font-mono text-xs text-emerald-300">{step.command}</pre>
              <div className="text-xs text-neutral-500">expect: {step.expected}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={`Mitigation plan (${a.mitigation_plan.length})`}>
        <ul className="flex flex-col gap-2">
          {a.mitigation_plan.map((m, i) => (
            <li key={i} className="text-sm">
              <div className="text-neutral-200">▸ {m.action}</div>
              <div className="pl-3 text-xs text-amber-300/80">risk: {m.risk}</div>
              <div className="pl-3 text-xs text-emerald-300/80">rollback: {m.rollback}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Customer impact">
        <p className="text-sm text-neutral-200">{a.customer_impact}</p>
      </Section>

      <Section title="Postmortem draft">
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{a.postmortem_draft}</ReactMarkdown>
        </div>
      </Section>

      <Section title={`Follow-ups (${a.follow_ups.length})`}>
        <ul className="flex flex-col gap-1">
          {a.follow_ups.map((f, i) => (
            <li key={i} className="text-sm text-neutral-200">
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${f.priority === "P0" ? "bg-red-500/15 text-red-300" : f.priority === "P1" ? "bg-amber-500/15 text-amber-300" : "bg-neutral-500/15 text-neutral-300"}`}>{f.priority}</span>
              {f.item} <span className="text-xs text-neutral-500">— {f.owner_role}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default function InvestigatePage() {
  const [slug, setSlug] = useState(SCENARIO_OPTIONS[0].slug);
  const [lang, setLang] = useState<"en" | "zh">("en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  async function run() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_slug: slug, output_language: lang }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(await readApiError(res, "Investigation failed"));
        return;
      }
      const j = await res.json();
      setResult(j as InvestigationResult);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agentic investigator</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            The agent gets only the <em>alert</em> — not the full incident dump. It calls read-only tools
            (<code className="text-neutral-300">get_metrics</code>, <code className="text-neutral-300">get_logs</code>,
            <code className="text-neutral-300"> get_deploy_history</code>, <code className="text-neutral-300">search_runbooks</code>)
            in a hand-written loop to <em>discover</em> the evidence, then writes the structured response. Every step is shown below.
          </p>
        </div>
        <Nav />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <select value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
          {SCENARIO_OPTIONS.map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "zh")} className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
          <option value="en">Output: English</option>
          <option value="zh">输出：中文</option>
        </select>
        <button
          onClick={loading ? stop : run}
          className={`rounded px-4 py-2 text-sm font-semibold text-white ${
            loading ? "bg-red-700 hover:bg-red-600" : "bg-emerald-600 hover:bg-emerald-500"
          }`}
        >
          {loading ? "Stop investigation" : "Run investigation"}
        </button>
      </div>

      {loading && (
        <div className="mb-6 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          The agent is calling tools and reasoning across steps. This makes several model calls (~30s on DeepSeek)…
        </div>
      )}
      {error && <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-400">
            <span>stop: <b className="text-neutral-200">{result.stop_reason}</b></span>
            <span>loop steps: <b className="text-neutral-200">{result.steps}</b></span>
            <span>model calls: <b className="text-neutral-200">{result.usage.model_calls}</b></span>
            <span>tool calls: <b className="text-neutral-200">{result.trace.filter((s) => s.status === "ok").length}</b></span>
            <span>tokens: <b className="text-neutral-200">{result.usage.tokens_in}/{result.usage.tokens_out}</b></span>
            <span>cost: <b className="text-neutral-200">${result.usage.cost_usd.toFixed(5)}</b></span>
            <span>{result.completed ? "✓ completed" : "⚠ incomplete"}</span>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold text-white">Investigation trace</h2>
            <TraceTimeline trace={result.trace} />
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold text-white">Structured response</h2>
            <AnalysisView a={result.analysis} />
          </div>
        </div>
      )}
    </main>
  );
}
