"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import { AnalysisSchema } from "@/lib/schema";
import { useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/messages";
import { Nav } from "@/components/Nav";
import { tryParseAlert } from "@/lib/alertParsers";
import { SAMPLE_ALERTS } from "@/lib/sampleAlerts";

const SAMPLE = `Time: 14:02 UTC. payment-svc p99 latency jumped from 120ms to 4.8s.
Error rate climbed from 0.1% to 12% (mostly 500s).
Logs show: "connection refused" from payment-svc -> postgres-primary.
Postgres CPU normal (35%), but active_connections = 500 / 500.
Recent change: payment-svc v2.41 deployed 13:50 UTC, added a new batch job.
On-call notes: customers reporting failed checkouts; CS queue spiking.`;

export default function Home() {
  const t = useT();
  const [raw, setRaw] = useState(SAMPLE);
  const [title, setTitle] = useState("payment-svc DB connection storm");
  const [service, setService] = useState("payment-svc");
  const [symptoms, setSymptoms] = useState("p99 latency 4.8s, 12% 500s, checkouts failing");
  const [version, setVersion] = useState<"v1" | "v2" | "v3">("v3");
  const [outputLang, setOutputLang] = useState<Locale>("en");
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [visionStatus, setVisionStatus] = useState<{ kind: "idle" | "uploading" | "ok" | "err"; msg?: string }>({ kind: "idle" });

  async function handleScreenshotUpload(file: File) {
    setVisionStatus({ kind: "uploading" });
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      try {
        const res = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
        const j = await res.json();
        if (!res.ok) {
          setVisionStatus({ kind: "err", msg: j.error === "MISSING_API_KEY" ? t("home.visionMissingKey") : j.message ?? "failed" });
          return;
        }
        const block = `\n\n## Screenshot description (${file.name})\n${j.description}\n`;
        setRaw((r) => r + block);
        setVisionStatus({ kind: "ok", msg: t("home.imageDescribed") });
      } catch (e) {
        setVisionStatus({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
      }
    };
    reader.readAsDataURL(file);
  }

  function parseAlertFromRaw() {
    const parsed = tryParseAlert(raw);
    if (!parsed) {
      setParseNotice(t("home.notRecognized"));
      return;
    }
    if (parsed.title) setTitle(parsed.title);
    if (parsed.service) setService(parsed.service);
    if (parsed.symptoms) setSymptoms(parsed.symptoms);
    setRaw(parsed.raw_context || raw);
    setParseNotice(`${t("home.parsed")} ${parsed.source}`);
  }
  const router = useRouter();
  const startedRef = useRef<number>(0);
  const [saving, setSaving] = useState(false);

  const { object, submit, isLoading, error } = useObject({
    api: "/api/analyze",
    schema: AnalysisSchema,
    onFinish: async ({ object }) => {
      if (!object) return;
      setSaving(true);
      try {
        const res = await fetch("/api/incidents/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            service,
            symptoms,
            raw_context: raw,
            analysis: object,
            latency_ms: Date.now() - startedRef.current,
            prompt_version: version,
            output_language: outputLang,
          }),
        });
        if (res.ok) {
          const { incident_id } = await res.json();
          router.push(`/incidents/${incident_id}`);
        }
      } catch (e) {
        console.error("save failed", e);
      } finally {
        setSaving(false);
      }
    },
  });

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{t("home.title")}</h1>
            <p className="text-neutral-400 mt-2 max-w-2xl">{t("home.subtitle")}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-xs px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300">
              {t("home.demoLimit")}
            </span>
            <Nav />
          </div>
        </header>

        <section className="grid gap-4 bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">{t("home.field.title")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">{t("home.field.service")}</span>
              <input
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">{t("home.field.symptoms")}</span>
              <input
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-neutral-500">{t("home.trySample")}</span>
            {SAMPLE_ALERTS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setRaw(JSON.stringify(s.payload, null, 2));
                  setParseNotice(null);
                }}
                className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:border-neutral-500"
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">{t("home.field.rawContext")}</span>
              <button
                type="button"
                onClick={parseAlertFromRaw}
                className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:border-emerald-500/70"
              >
                {t("home.parseAlert")}
              </button>
            </div>
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setParseNotice(null);
              }}
              rows={10}
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 font-mono text-sm"
            />
            {parseNotice && (
              <span className={`text-xs ${parseNotice.includes(t("home.notRecognized")) ? "text-amber-400" : "text-emerald-400"}`}>
                {parseNotice}
              </span>
            )}
            <div className="flex items-center gap-3 mt-1">
              <label className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:border-emerald-500/70 cursor-pointer">
                {t("home.uploadScreenshot")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleScreenshotUpload(f);
                  }}
                />
              </label>
              {visionStatus.kind === "uploading" && <span className="text-xs text-neutral-500 animate-pulse">{t("home.describingImage")}</span>}
              {visionStatus.kind === "ok" && <span className="text-xs text-emerald-400">{visionStatus.msg}</span>}
              {visionStatus.kind === "err" && <span className="text-xs text-amber-400">{visionStatus.msg}</span>}
            </div>
          </label>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-neutral-400 mr-1">{t("home.promptLabel")}</span>
              {(["v1", "v2", "v3"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVersion(v)}
                  className={`px-2 py-1 rounded border ${version === v ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-neutral-400 mr-1">{t("home.outputLanguage")}</span>
              {LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setOutputLang(l)}
                  className={`px-2 py-1 rounded border ${outputLang === l ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}
                >
                  {LOCALE_LABELS[l]}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                startedRef.current = Date.now();
                submit({ title, service, symptoms, raw_context: raw, prompt_version: version, output_language: outputLang });
              }}
              disabled={isLoading || saving || raw.length < 20}
              className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-md"
            >
              {isLoading ? t("home.streaming") : saving ? t("home.saving") : t("home.analyze")}
            </button>
            {isLoading && <span className="text-xs text-neutral-500 animate-pulse">{t("home.generatingHint")}</span>}
            {saving && <span className="text-xs text-neutral-500">{t("home.savingHint")}</span>}
          </div>
          {error && (
            <p className="text-red-400 text-sm">
              {error.message?.includes("MISSING_API_KEY") ? t("home.errorMissingKey") : `${t("common.error")}: ${error.message}`}
            </p>
          )}
        </section>

        {object && <AnalysisView a={object} />}
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

function SeverityBadge({ s }: { s?: string }) {
  if (!s) return null;
  const color =
    s === "SEV1" ? "bg-red-500/20 text-red-300 border-red-500/40" :
    s === "SEV2" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  return <span className={`inline-block text-xs px-2 py-1 rounded border ${color}`}>{s}</span>;
}

type PartialAnalysis = Partial<{
  summary: string;
  severity: string;
  severity_reasoning: string;
  root_causes: Array<{ hypothesis?: string; evidence?: string; likelihood?: string } | undefined>;
  investigation_checklist: Array<{ step?: string; command?: string; expected?: string } | undefined>;
  mitigation_plan: Array<{ action?: string; risk?: string; rollback?: string } | undefined>;
  customer_impact: string;
  postmortem_draft: string;
  follow_ups: Array<{ item?: string; owner_role?: string; priority?: string } | undefined>;
}>;

function AnalysisView({ a }: { a: PartialAnalysis }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 w-full">
      {(a.summary || a.severity) && (
        <Section title={t("section.summary")}>
          <div className="flex items-start gap-3">
            <SeverityBadge s={a.severity} />
            <p className="text-neutral-200">{a.summary || "..."}</p>
          </div>
          {a.severity_reasoning && (
            <p className="text-sm text-neutral-400 mt-2">{t("section.severityReasoning")} {a.severity_reasoning}</p>
          )}
        </Section>
      )}

      {a.root_causes && a.root_causes.length > 0 && (
        <Section title={t("section.rootCauses")}>
          <ul className="space-y-3">
            {a.root_causes.map((r, i) =>
              r ? (
                <li key={i} className="border-l-2 border-indigo-500/50 pl-3">
                  <div className="flex gap-2 items-center">
                    {r.likelihood && <span className="text-xs uppercase text-neutral-500">{r.likelihood}</span>}
                    <span className="font-medium">{r.hypothesis}</span>
                  </div>
                  {r.evidence && <p className="text-sm text-neutral-400 mt-1">{t("section.evidence")} {r.evidence}</p>}
                </li>
              ) : null
            )}
          </ul>
        </Section>
      )}

      {a.investigation_checklist && a.investigation_checklist.length > 0 && (
        <Section title={t("section.investigation")}>
          <ol className="space-y-3 list-decimal list-inside">
            {a.investigation_checklist.map((s, i) =>
              s ? (
                <li key={i}>
                  <span className="font-medium">{s.step}</span>
                  {s.command && (
                    <pre className="mt-1 bg-neutral-950 border border-neutral-800 rounded p-2 text-xs overflow-x-auto"><code>{s.command}</code></pre>
                  )}
                  {s.expected && <p className="text-xs text-neutral-400 mt-1">{t("section.expected")} {s.expected}</p>}
                </li>
              ) : null
            )}
          </ol>
        </Section>
      )}

      {a.mitigation_plan && a.mitigation_plan.length > 0 && (
        <Section title={t("section.mitigation")}>
          <ul className="space-y-3">
            {a.mitigation_plan.map((m, i) =>
              m ? (
                <li key={i}>
                  <p className="font-medium">{m.action}</p>
                  {m.risk && <p className="text-xs text-amber-300/80">{t("section.risk")} {m.risk}</p>}
                  {m.rollback && <p className="text-xs text-neutral-400">{t("section.rollback")} {m.rollback}</p>}
                </li>
              ) : null
            )}
          </ul>
        </Section>
      )}

      {a.customer_impact && (
        <Section title={t("section.customerImpact")}>
          <p className="text-neutral-200 whitespace-pre-wrap">{a.customer_impact}</p>
        </Section>
      )}

      {a.postmortem_draft && (
        <Section title={t("section.postmortem")}>
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-li:text-neutral-300 prose-strong:text-neutral-100">
            <ReactMarkdown>{a.postmortem_draft}</ReactMarkdown>
          </div>
        </Section>
      )}

      {a.follow_ups && a.follow_ups.length > 0 && (
        <Section title={t("section.followUps")}>
          <ul className="space-y-2">
            {a.follow_ups.map((f, i) =>
              f ? (
                <li key={i} className="flex gap-2 text-sm">
                  {f.priority && <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">{f.priority}</span>}
                  <span className="text-neutral-200">{f.item}</span>
                  {f.owner_role && <span className="text-neutral-500">— {f.owner_role}</span>}
                </li>
              ) : null
            )}
          </ul>
        </Section>
      )}
    </div>
  );
}
