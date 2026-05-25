"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT, useLocale } from "@/lib/i18n/client";

export function ReRunButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [loading, setLoading] = useState<null | "v1" | "v2">(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(version: "v1" | "v2") {
    setLoading(version);
    setErr(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/rerun?version=${version}&language=${locale}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || "rerun failed");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {(["v1", "v2"] as const).map((v) => (
        <button
          key={v}
          type="button"
          disabled={loading !== null}
          onClick={() => run(v)}
          className="text-sm bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded px-3 py-1.5 text-neutral-200 disabled:opacity-50"
        >
          {loading === v ? `${t("detail.runningV")} ${v}...` : `${t("detail.rerunV")} ${v}`}
        </button>
      ))}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
