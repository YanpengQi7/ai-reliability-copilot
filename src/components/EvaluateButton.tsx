"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { readApiError } from "@/lib/http";

export function EvaluateButton({ analysisId, scenarioSlug }: { analysisId: string; scenarioSlug?: string }) {
  const router = useRouter();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ overall: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setErr(null);
          try {
            const res = await fetch("/api/evaluate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ analysis_id: analysisId, scenario_slug: scenarioSlug }),
            });
            if (!res.ok) throw new Error(await readApiError(res, "evaluate failed"));
            const data = await res.json();
            setResult({ overall: data.overall });
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setLoading(false);
          }
        }}
        className="text-sm bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded px-3 py-1.5 text-neutral-200 disabled:opacity-50"
      >
        {loading ? t("detail.judging") : result ? `${t("detail.scored")} ${result.overall.toFixed(2)} / 5` : t("detail.evaluate")}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
