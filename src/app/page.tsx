"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { AnalysisSchema } from "@/lib/schema";
import { useT } from "@/lib/i18n/client";
import { Nav } from "@/components/Nav";
import { makeUsageCapturingFetch, type StreamUsage } from "@/lib/streamUsage";
import { readApiError } from "@/lib/http";
import { StreamingAnalysisView } from "@/components/StreamingAnalysisView";
import { IncidentInputForm, type IncidentInput } from "@/components/IncidentInputForm";

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generationStopped, setGenerationStopped] = useState(false);

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
            latency_ms: Date.now() - startedRef.current,
            prompt_version: submittedInput.prompt_version,
            output_language: submittedInput.output_language,
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

  useEffect(() => () => stop(), [stop]);

  function analyze() {
    submittedInputRef.current = { ...input };
    usageRef.current = null;
    startedRef.current = Date.now();
    setSaveError(null);
    setGenerationStopped(false);
    submit(input);
  }

  function stopGenerating() {
    stop();
    submittedInputRef.current = null;
    usageRef.current = null;
    setGenerationStopped(true);
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
        />

        {object && (
          <div aria-live="polite" aria-busy={isLoading}>
            <StreamingAnalysisView analysis={object} />
          </div>
        )}
      </div>
    </main>
  );
}
