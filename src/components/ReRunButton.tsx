"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReRunButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
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
            const res = await fetch(`/api/incidents/${incidentId}/rerun`, { method: "POST" });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error(j.message || "rerun failed");
            }
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setLoading(false);
          }
        }}
        className="text-sm bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded px-3 py-1.5 text-neutral-200 disabled:opacity-50"
      >
        {loading ? "Running..." : "Re-run analysis with current prompt"}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
