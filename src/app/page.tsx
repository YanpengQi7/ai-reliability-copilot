"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { AnalysisSchema } from "@/lib/schema";
import { useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/messages";
import { Nav } from "@/components/Nav";
import { tryParseAlert } from "@/lib/alertParsers";
import { SAMPLE_ALERTS } from "@/lib/sampleAlerts";
import { makeUsageCapturingFetch, type StreamUsage } from "@/lib/streamUsage";
import { readApiError } from "@/lib/http";
import {
  ALLOWED_IMAGE_TYPES,
  INPUT_LIMITS,
  safeDisplayFilename,
  validateImageFile,
} from "@/lib/requestSafety";
import { StreamingAnalysisView } from "@/components/StreamingAnalysisView";

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
  const rawRef = useRef(raw);

  useEffect(() => {
    rawRef.current = raw;
  }, [raw]);

  async function handleScreenshotUpload(file: File) {
    const validationError = validateImageFile(file);
    if (validationError) {
      setVisionStatus({
        kind: "err",
        msg: t(validationError === "file_too_large" ? "home.imageTooLarge" : "home.imageUnsupported"),
      });
      return;
    }
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
        const block = `\n\n## Screenshot description (${safeDisplayFilename(file.name)})\n${j.description}\n`;
        if (rawRef.current.length + block.length > INPUT_LIMITS.rawContext) {
          setVisionStatus({ kind: "err", msg: t("home.contextTooLong") });
          return;
        }
        setRaw((current) => current + block);
        setVisionStatus({ kind: "ok", msg: t("home.imageDescribed") });
      } catch (e) {
        setVisionStatus({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
      }
    };
    reader.onerror = () => setVisionStatus({ kind: "err", msg: t("common.error") });
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
  const usageRef = useRef<StreamUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Peel the token-usage trailer off the stream before useObject parses the
  // JSON; stash it in a ref for the save call below. The write runs only inside
  // the stream transform's flush(), which the TransformStream contract
  // guarantees completes before the readable closes — i.e. before useObject's
  // onFinish reads usageRef. The refs lint rule can't see that deferral, so the
  // disable below is a documented false positive, not a real render-time read.
  const onUsage = useCallback((u: StreamUsage | null) => {
    usageRef.current = u;
  }, []);
  // eslint-disable-next-line react-hooks/refs -- onUsage writes the ref only in async flush(), never during render
  const capturingFetch = useMemo(() => makeUsageCapturingFetch(onUsage), [onUsage]);

  const { object, submit, isLoading, error } = useObject({
    api: "/api/analyze",
    schema: AnalysisSchema,
    fetch: capturingFetch,
    onFinish: async ({ object }) => {
      if (!object) return;
      setSaving(true);
      setSaveError(null);
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
            usage: usageRef.current ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(await readApiError(res, t("home.saveFailed")));
        const { incident_id } = await res.json();
        router.push(`/incidents/${incident_id}`);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
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
              maxLength={INPUT_LIMITS.shortText}
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">{t("home.field.service")}</span>
              <input
                value={service}
                onChange={(e) => setService(e.target.value)}
                maxLength={INPUT_LIMITS.shortText}
                className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">{t("home.field.symptoms")}</span>
              <input
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                maxLength={INPUT_LIMITS.shortText}
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
              maxLength={INPUT_LIMITS.rawContext}
              aria-describedby="raw-context-count"
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 font-mono text-sm"
            />
            <span
              id="raw-context-count"
              className={`text-right text-xs ${raw.length >= INPUT_LIMITS.rawContext ? "text-amber-400" : "text-neutral-500"}`}
            >
              {raw.length.toLocaleString()} / {INPUT_LIMITS.rawContext.toLocaleString()} {t("home.characters")}
            </span>
            {parseNotice && (
              <span className={`text-xs ${parseNotice.includes(t("home.notRecognized")) ? "text-amber-400" : "text-emerald-400"}`}>
                {parseNotice}
              </span>
            )}
            <div className="flex items-center gap-3 mt-1">
              <label className={`text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 ${visionStatus.kind === "uploading" ? "cursor-not-allowed opacity-50" : "hover:border-emerald-500/70 cursor-pointer"}`}>
                {t("home.uploadScreenshot")}
                <input
                  type="file"
                  accept={ALLOWED_IMAGE_TYPES.join(",")}
                  disabled={visionStatus.kind === "uploading"}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleScreenshotUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <span role="status" aria-live="polite">
                {visionStatus.kind === "uploading" && <span className="text-xs text-neutral-500 animate-pulse">{t("home.describingImage")}</span>}
                {visionStatus.kind === "ok" && <span className="text-xs text-emerald-400">{visionStatus.msg}</span>}
                {visionStatus.kind === "err" && <span className="text-xs text-amber-400">{visionStatus.msg}</span>}
              </span>
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
                setSaveError(null);
                submit({ title, service, symptoms, raw_context: raw, prompt_version: version, output_language: outputLang });
              }}
              disabled={isLoading || saving || visionStatus.kind === "uploading" || raw.length < 20}
              className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-md"
            >
              {isLoading ? t("home.streaming") : saving ? t("home.saving") : t("home.analyze")}
            </button>
            <span role="status" aria-live="polite">
              {isLoading && <span className="text-xs text-neutral-500 animate-pulse">{t("home.generatingHint")}</span>}
              {saving && <span className="text-xs text-neutral-500">{t("home.savingHint")}</span>}
            </span>
          </div>
          {error && (
            <p className="text-red-400 text-sm">
              {error.message?.includes("MISSING_API_KEY") ? t("home.errorMissingKey") : `${t("common.error")}: ${error.message}`}
            </p>
          )}
          {saveError && (
            <div role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <p className="font-medium">{t("home.analysisNotSaved")}</p>
              <p className="mt-1 text-xs text-amber-200/80">{saveError}</p>
            </div>
          )}
        </section>

        {object && (
          <div aria-live="polite" aria-busy={isLoading}>
            <StreamingAnalysisView analysis={object} />
          </div>
        )}
      </div>
    </main>
  );
}
