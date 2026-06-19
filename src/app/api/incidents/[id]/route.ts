// GET /api/incidents/[id] — JSON view of an incident + its latest analysis.
//
// Used by the `sre` CLI to poll for analysis completion after a webhook submit.
// Browser UI continues to use the RSC page at /incidents/[id].
//
// Response shape:
//   200 { incident, analysis: AnalysisRow | null, url: string }
//   404 { error: "NOT_FOUND", ... }
//   500 { error: "DB_ERROR", ... }
//   503 { error: "DB_UNCONFIGURED", ... }

import { NextResponse } from "next/server";
import { hasSupabase, getIncidentWithAnalyses } from "@/lib/db";
import { apiError } from "@/lib/http";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { requestHasIncidentDataAccess } from "@/lib/incidentAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = createRequestContext(req, "get_incident");
  const { id } = await params;
  if (!requestHasIncidentDataAccess(req)) {
    return ctx.response(apiError(403, "INCIDENT_DATA_PRIVATE", "Persisted incident data is private on this deployment.", { requestId: ctx.requestId }));
  }
  if (!hasSupabase()) {
    return ctx.response(apiError(503, "DB_UNCONFIGURED", "Supabase not configured", { requestId: ctx.requestId }));
  }
  let result: Awaited<ReturnType<typeof getIncidentWithAnalyses>>;
  try {
    result = await getIncidentWithAnalyses(id, { abortSignal: req.signal });
  } catch (error) {
    ctx.log("error", "incident_query_failed", { error: safeErrorDetail(error), incident_id: id });
    return ctx.response(apiError(500, "DB_ERROR", "Could not load the incident.", { requestId: ctx.requestId }));
  }
  if (!result) {
    return ctx.response(apiError(404, "NOT_FOUND", "incident not found", { requestId: ctx.requestId }));
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  return ctx.response(NextResponse.json({
    incident: result.incident,
    analysis: result.analyses[0] ?? null,
    url: `${base}/incidents/${id}`,
  }), { incident_id: id, has_analysis: result.analyses.length > 0 });
}
