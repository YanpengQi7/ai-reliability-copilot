// GET /api/incidents/[id] — JSON view of an incident + its latest analysis.
//
// Used by the `sre` CLI to poll for analysis completion after a webhook submit.
// Browser UI continues to use the RSC page at /incidents/[id].
//
// Response shape:
//   200 { incident, analysis: AnalysisRow | null, url: string }
//   400 { error: "VALIDATION_ERROR", ... }
//   404 { error: "NOT_FOUND", ... }
//   499 { error: "REQUEST_ABORTED", ... }
//   500 { error: "DB_ERROR", ... }
//   503 { error: "DB_UNCONFIGURED", ... }

import { NextResponse } from "next/server";
import { hasSupabase, getIncidentWithAnalyses } from "@/lib/db";
import { apiError } from "@/lib/http";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { requestHasIncidentDataAccess } from "@/lib/incidentAccess";
import { isIncidentId } from "@/lib/identifiers";
import { resolveAppBaseUrl } from "@/lib/appUrl";
import { classifyDatabaseDeadlineFailure, createDatabaseDeadline, DATABASE_QUERY_TIMEOUT_MS } from "@/lib/databaseDeadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = createRequestContext(req, "get_incident");
  const { id } = await params;
  if (!requestHasIncidentDataAccess(req)) {
    return ctx.response(apiError(403, "INCIDENT_DATA_PRIVATE", "Persisted incident data is private on this deployment.", { requestId: ctx.requestId }));
  }
  if (!isIncidentId(id)) {
    return ctx.response(apiError(400, "VALIDATION_ERROR", "Incident id must be a UUID.", { requestId: ctx.requestId }));
  }
  if (!hasSupabase()) {
    return ctx.response(apiError(503, "DB_UNCONFIGURED", "Supabase not configured", { requestId: ctx.requestId }));
  }
  const databaseDeadline = createDatabaseDeadline(req.signal);
  let result: Awaited<ReturnType<typeof getIncidentWithAnalyses>>;
  try {
    result = await getIncidentWithAnalyses(id, { abortSignal: databaseDeadline.signal });
  } catch (error) {
    const failure = classifyDatabaseDeadlineFailure(req.signal, databaseDeadline);
    if (failure === "request_aborted") {
      ctx.log("warn", "incident_query_aborted", { incident_id: id });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Incident query was cancelled.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "incident_query_failed", { error: safeErrorDetail(error), incident_id: id });
    if (failure === "timed_out") {
      return ctx.response(apiError(504, "DB_TIMEOUT", `Incident query timed out after ${DATABASE_QUERY_TIMEOUT_MS / 1000}s.`, { requestId: ctx.requestId }));
    }
    return ctx.response(apiError(500, "DB_ERROR", "Could not load the incident.", { requestId: ctx.requestId }));
  }
  if (!result) {
    return ctx.response(apiError(404, "NOT_FOUND", "incident not found", { requestId: ctx.requestId }));
  }
  const base = resolveAppBaseUrl(req.url);
  return ctx.response(NextResponse.json({
    incident: result.incident,
    analysis: result.analyses[0] ?? null,
    url: `${base}/incidents/${id}`,
  }), { incident_id: id, has_analysis: result.analyses.length > 0 });
}
