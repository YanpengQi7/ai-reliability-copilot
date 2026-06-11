import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase";
import { createRequestContext } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DB_TIMEOUT_MS = 3_000;

/**
 * Liveness + readiness probe. Returns 200 only if:
 *   - Required env vars are present (DEEPSEEK_API_KEY, Supabase URL + service key)
 *   - Supabase Postgres responds within the timeout
 *
 * Suitable for Vercel uptime monitor, BetterStack, Pingdom, etc.
 * Intentionally cheap (HEAD-style count on a single table).
 */
export async function GET(req: Request) {
  const ctx = createRequestContext(req, "healthz");
  const started = Date.now();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.deepseek_key = { ok: Boolean(process.env.DEEPSEEK_API_KEY) };
  checks.supabase_env = { ok: hasSupabase() };

  if (checks.supabase_env.ok) {
    try {
      const sb = supabaseAdmin();
      const { error } = await sb
        .from("incidents")
        .select("*", { count: "exact", head: true })
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      checks.supabase_query = { ok: !error, detail: error?.message };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      checks.supabase_query = {
        ok: false,
        detail: timedOut ? `timed out after ${DB_TIMEOUT_MS}ms` : e instanceof Error ? e.message : String(e),
      };
    }
  } else {
    checks.supabase_query = { ok: false, detail: "skipped (env missing)" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return ctx.response(
    NextResponse.json(
      {
        status: allOk ? "ok" : "degraded",
        latency_ms: Date.now() - started,
        checks,
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
        ts: new Date().toISOString(),
      },
      {
        status: allOk ? 200 : 503,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    ),
    { healthy: allOk },
  );
}
