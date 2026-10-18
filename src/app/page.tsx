"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { AnalysisSchema } from "@/lib/schema";
import type { AnalysisContent } from "@/lib/analysisReview";
import { AnalysisExport } from "@/components/AnalysisExport";
import { ResponseWorkspace } from "@/components/ResponseWorkspace";
import { useT } from "@/lib/i18n/client";
import { Nav } from "@/components/Nav";
import { makeUsageCapturingFetch, type StreamUsage } from "@/lib/streamUsage";
import { readApiError } from "@/lib/http";
import { StreamingAnalysisView } from "@/components/StreamingAnalysisView";
import { IncidentInputForm, type IncidentInput } from "@/components/IncidentInputForm";
import { prepareIncidentSubmission } from "@/lib/incidentPreflight";

const SAMPLE = `Time: 14:02 UTC. payment-svc p99 latency jumped from 120ms to 4.8s.
Error rate climbed from 0.1% to 12% (mostly 500s).
Logs show: "connection refused" from payment-svc -> postgres-primary.
Postgres CPU normal (35%), but active_connections = 500 / 500.
Recent change: payment-svc v2.41 deployed 13:50 UTC, added a new batch job.
On-call notes: customers reporting failed checkouts; CS queue spiking.`;

export default function Home() {
  const t = useT();
  const [input, setInput] = useState<IncidentInput>({
    title: "payment-svc DB connection storm",
    service: "payment-svc",
    symptoms: "p99 latency 4.8s, 12% 500s, checkouts failing",
    raw_context: SAMPLE,
    prompt_version: "v3",
    output_language: "en",
  });
  const router = useRouter();
  const startedRef = useRef<number>(0);
  const usageRef = useRef<StreamUsage | null>(null);
  const submittedInputRef = useRef<IncidentInput | null>(null);
  const completedRunRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generationStopped, setGenerationStopped] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [completedReport, setCompletedReport] = useState<{ analysis: AnalysisContent; input: IncidentInput; workspaceId: string } | null>(null);

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

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/analyze",
    schema: AnalysisSchema,
    fetch: capturingFetch,
    onFinish: async ({ object }) => {
      if (!object) return;
      const submittedInput = submittedInputRef.current;
      if (!submittedInput) return;
      const latencyMs = Date.now() - startedRef.current;
      setCompletedReport({
        // This key is memory-only, so a fresh per-page run counter also works
        // for self-hosted HTTP pages where crypto.randomUUID is unavailable.
        workspaceId: `session:${++completedRunRef.current}`,
        analysis: {
          ...object,
          prompt_version: submittedInput.prompt_version,
          output_language: submittedInput.output_language,
          created_at: new Date().toISOString(),
          latency_ms: latencyMs,
          ...usageRef.current,
        },
        input: { ...submittedInput },
      });
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch("/api/incidents/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: submittedInput.title,
            service: submittedInput.service,
            symptoms: submittedInput.symptoms,
            raw_context: submittedInput.raw_context,
            analysis: object,
            latency_ms: latencyMs,
            prompt_version: submittedInput.prompt_version,
            output_language: submittedInput.output_language,
            usage: usageRef.current ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(await readApiError(res, t("home.saveFailed")));
        const saved = await res.json() as { persisted?: boolean; incident_id?: string; reason?: string };
        if (!saved.persisted || !saved.incident_id) {
          setSaveError(saved.reason ?? t("home.persistenceDisabled"));
          return;
        }
        const { incident_id } = saved;
        router.push(`/incidents/${incident_id}`);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
  });

  useEffect(() => () => stop(), [stop]);

  function analyze() {
    const prepared = prepareIncidentSubmission(input);
    if (!prepared.ok) {
      const label = prepared.field === "raw_context" ? "home.preflight.context" : `home.field.${prepared.field}`;
      setInputError(`${t(label)} ${t(prepared.error === "too_long" ? "home.preflight.tooLong" : "home.preflight.tooShort")} (${prepared.limit} ${t("home.characters")})`);
      return;
    }
    const safeInput = prepared.input;
    setInput(safeInput);
    setInputError(null);
    submittedInputRef.current = { ...safeInput };
    usageRef.current = null;
    startedRef.current = Date.now();
    setSaveError(null);
    setGenerationStopped(false);
    setCompletedReport(null);
    submit(safeInput);
  }

  function stopGenerating() {
    stop();
    submittedInputRef.current = null;
    usageRef.current = null;
    setGenerationStopped(true);
    setCompletedReport(null);
  }

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

        <IncidentInputForm
          value={input}
          onChange={setInput}
          onSubmit={analyze}
          onStop={stopGenerating}
          isLoading={isLoading}
          isSaving={saving}
          generationStopped={generationStopped}
          analysisError={error}
          saveError={saveError}
          inputError={inputError}
        />

        {completedReport && (
          <>
            <AnalysisExport analysis={completedReport.analysis} context={completedReport.input} />
            {!saving && saveError !== null && (
              <ResponseWorkspace
                key={completedReport.workspaceId}
                workspaceId={completedReport.workspaceId}
                analysis={completedReport.analysis}
                context={{ title: completedReport.input.title, service: completedReport.input.service }}
              />
            )}
          </>
        )}

        {object && (
          <div aria-live="polite" aria-busy={isLoading}>
            <StreamingAnalysisView analysis={object} />
          </div>
        )}
      </div>
    </main>
  );
}
