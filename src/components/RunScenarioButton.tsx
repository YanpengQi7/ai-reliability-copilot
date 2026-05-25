"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT, useLocale } from "@/lib/i18n/client";

export function RunScenarioButton({ slug }: { slug: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setErr(null);
          try {
            const res = await fetch(`/api/scenarios/${slug}/run?language=${locale}`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "run failed");
            router.push(`/incidents/${data.incident_id}`);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        }}
        className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded"
      >
        {loading ? t("scenarios.running") : t("scenarios.runWithAI")}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
