import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema, type Analysis } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase";
import { getIncident, hasSupabase } from "@/lib/db";
import { calcCost, normalizeUsage } from "@/lib/cost";
import { retrieveContext, formatChunksForPrompt, recordRetrievedChunks } from "@/lib/kb";
import { apiError } from "@/lib/http";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { requestHasIncidentDataAccess } from "@/lib/incidentAccess";
import { classifyProviderDeadlineFailure, createProviderDeadline, PROVIDER_TIMEOUT_MS } from "@/lib/providerDeadline";
import { buildAnalysisRecord } from "@/lib/analysisRecord";
import { parseAnalysisOptions } from "@/lib/analysisOptions";
import { isIncidentId } from "@/lib/identifiers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = createRequestContext(req, "rerun_incident");
  const { id } = await params;
  if (!requestHasIncidentDataAccess(req)) {
    return ctx.response(apiError(403, "INCIDENT_DATA_PRIVATE", "Persisted incident data is private on this deployment.", { requestId: ctx.requestId }));
  }
  if (!isIncidentId(id)) {
    return ctx.response(apiError(400, "VALIDATION_ERROR", "Incident id must be a UUID.", { requestId: ctx.requestId }));
  }
  const url = new URL(req.url);
  const options = parseAnalysisOptions(url.searchParams);
  if (!options.ok) {
    return ctx.response(apiError(400, "VALIDATION_ERROR", options.message, { requestId: ctx.requestId }));
  }
  const { version, language } = options;
  if (!process.env.DEEPSEEK_API_KEY) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY not set", { requestId: ctx.requestId }));
  }
  if (!hasSupabase()) {
    return ctx.response(apiError(503, "DB_UNCONFIGURED", "Supabase not configured", { requestId: ctx.requestId }));
  }
  const rl = await rateLimit(clientKey(req), { max: 3, namespace: "rerun" });
  if (!rl.allowed) {
    return ctx.response(withRateLimitHeaders(apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s.`, { requestId: ctx.requestId }), rl));
  }
  const sb = supabaseAdmin();
  let incident: Awaited<ReturnType<typeof getIncident>>;
  try {
    incident = await getIncident(id, { abortSignal: req.signal });
  } catch (error) {
    if (req.signal.aborted) {
      ctx.log("warn", "rerun_incident_query_aborted", { incident_id: id });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Incident query was cancelled.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "rerun_incident_query_failed", { error: safeErrorDetail(error), incident_id: id });
    return ctx.response(apiError(500, "DB_ERROR", "Could not load the incident.", { requestId: ctx.requestId }));
  }
  if (!incident) {
    return ctx.response(apiError(404, "NOT_FOUND", "incident not found", { requestId: ctx.requestId }));
  }

  const started = Date.now();
  const deadline = createProviderDeadline(req.signal);
  const queryText = [incident.title, incident.service, incident.symptoms, incident.raw_context].filter(Boolean).join(" ").slice(0, 4000);
  const retrieved = await retrieveContext(queryText, { limit: 5, abortSignal: deadline.signal });
  const internal_context = formatChunksForPrompt(retrieved.chunks);
  let object: Analysis;
  let tokens_in = 0;
  let tokens_out = 0;
  try {
    const result = await generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: getSystemPrompt(version),
      prompt: buildUserPrompt({
        service: incident.service ?? undefined,
        symptoms: incident.symptoms ?? undefined,
        raw_context: incident.raw_context,
        language,
        internal_context,
      }),
      temperature: 0.2,
      abortSignal: deadline.signal,
    });
    object = result.object;
    ({ tokens_in, tokens_out } = normalizeUsage(result.usage));
  } catch (err) {
    const failure = classifyProviderDeadlineFailure(req.signal, deadline);
    if (failure === "request_aborted") {
      ctx.log("warn", "rerun_request_aborted", { incident_id: id });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Analysis was cancelled.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "rerun_provider_failed", { error: safeErrorDetail(err), incident_id: id });
    if (failure === "timed_out") {
      return ctx.response(apiError(504, "ANALYSIS_TIMEOUT", `Analysis timed out after ${PROVIDER_TIMEOUT_MS / 1000}s.`, { requestId: ctx.requestId }));
    }
    return ctx.response(apiError(502, "LLM_ERROR", "Analysis provider failed. Please try again.", { requestId: ctx.requestId }));
  }

  const latency = Date.now() - started;
  const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);
  const { data: anaRow, error: e1 } = await sb.from("analyses").insert(
    buildAnalysisRecord({
      incidentId: id,
      analysis: object,
      model: ANALYSIS_MODEL,
      promptVersion: version,
      outputLanguage: language,
      latencyMs: latency,
      usage: { tokens_in, tokens_out, cost_usd },
    }),
  ).select("id").abortSignal(req.signal).single();
  if (e1 || !anaRow) {
    if (req.signal.aborted) {
      ctx.log("warn", "rerun_analysis_write_aborted", { incident_id: id });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Analysis save was cancelled.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "rerun_analysis_insert_failed", {
      error: safeErrorDetail(e1 ?? new Error("Analysis insert returned no row.")),
      incident_id: id,
    });
    return ctx.response(apiError(500, "DB_ERROR", "Could not save the analysis.", { requestId: ctx.requestId }));
  }
  try {
    await recordRetrievedChunks(anaRow.id, retrieved.chunks, { abortSignal: req.signal });
  } catch (error) {
    if (!req.signal.aborted) {
      ctx.log("warn", "rerun_kb_audit_write_failed", {
        error: safeErrorDetail(error),
        analysis_id: anaRow.id,
        incident_id: id,
      });
    }
  }
  return ctx.response(NextResponse.json({ ok: true, latency_ms: latency }), {
    incident_id: id,
    prompt_version: version,
    output_language: language,
  });
}
