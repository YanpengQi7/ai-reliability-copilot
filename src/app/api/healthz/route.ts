import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { distributedRateLimitConfigured } from "@/lib/rateLimit";
import { requestCanSeeHealthDetails } from "@/lib/deployment";
import { createDatabaseDeadline } from "@/lib/databaseDeadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DB_TIMEOUT_MS = 3_000;

/**
 * Readiness probe. Returns 200 only if:
 *   - Required env vars are present (DEEPSEEK_API_KEY, Supabase URL + service key)
 *   - Supabase Postgres responds within the timeout
 *
 * Use /api/livez for a dependency-free process liveness probe.
 */
export async function GET(req: Request) {
  const ctx = createRequestContext(req, "healthz");
  const started = Date.now();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.deepseek_key = { ok: Boolean(process.env.DEEPSEEK_API_KEY) };
  checks.supabase_env = { ok: hasSupabase() };

  if (checks.supabase_env.ok) {
    const deadline = createDatabaseDeadline(req.signal, DB_TIMEOUT_MS);
    try {
      const sb = supabaseAdmin();
      const { error } = await sb
        .from("incidents")
        .select("id")
        .limit(1)
        .abortSignal(deadline.signal);
      deadline.signal.throwIfAborted();
      checks.supabase_query = { ok: !error, detail: error?.message };
    } catch (e) {
      checks.supabase_query = {
        ok: false,
        detail: deadline.timeoutSignal.aborted
          ? `timed out after ${DB_TIMEOUT_MS}ms`
          : req.signal.aborted ? "cancelled by client" : safeErrorDetail(e),
      };
    }
  } else {
    checks.supabase_query = { ok: false, detail: "skipped (env missing)" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const summary = {
    status: allOk ? "ok" : "degraded",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    ts: new Date().toISOString(),
  };
  const payload = requestCanSeeHealthDetails(req)
    ? {
        ...summary,
        latency_ms: Date.now() - started,
        checks,
        capabilities: {
          distributed_rate_limit: distributedRateLimitConfigured(),
        },
      }
    : summary;
  return ctx.response(
    NextResponse.json(
      payload,
      {
        status: allOk ? 200 : 503,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    ),
    { healthy: allOk },
  );
}
