import { NextResponse } from "next/server";
import { z } from "zod";
import { judge } from "@/lib/eval/judge";
import { RUBRIC_VERSION, overallScore } from "@/lib/eval/rubric";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { JUDGE_MODEL } from "@/lib/ai";
import { SCENARIOS } from "@/lib/scenarios";
import { apiError } from "@/lib/http";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { requestHasIncidentDataAccess } from "@/lib/incidentAccess";
import { INPUT_LIMITS, readJsonBody } from "@/lib/requestSafety";
import { classifyProviderDeadlineFailure, createProviderDeadline, PROVIDER_TIMEOUT_MS } from "@/lib/providerDeadline";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  analysis_id: z.string().uuid(),
  scenario_slug: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = createRequestContext(req, "evaluate_analysis");
  if (!requestHasIncidentDataAccess(req)) {
    return ctx.response(apiError(403, "INCIDENT_DATA_PRIVATE", "Persisted incident data is private on this deployment.", { requestId: ctx.requestId }));
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY not set", { requestId: ctx.requestId }));
  }
  if (!hasSupabase()) {
    return ctx.response(apiError(503, "DB_UNCONFIGURED", "Supabase not configured", { requestId: ctx.requestId }));
  }
  const rl = await rateLimit(clientKey(req), { max: 3, namespace: "evaluate" });
  if (!rl.allowed) {
    return ctx.response(withRateLimitHeaders(apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s.`, { requestId: ctx.requestId }), rl));
  }
  const bodyResult = await readJsonBody(req, INPUT_LIMITS.smallJson);
  if (!bodyResult.ok && bodyResult.error === "payload_too_large") {
    return ctx.response(apiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.", { requestId: ctx.requestId }));
  }
  if (!bodyResult.ok) {
    return ctx.response(apiError(400, "INVALID_JSON", "Body must be JSON", { requestId: ctx.requestId }));
  }
  const parsed = Body.safeParse(bodyResult.value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return ctx.response(apiError(400, "VALIDATION_ERROR", message, { requestId: ctx.requestId }));
  }
  const { analysis_id, scenario_slug } = parsed.data;
  const sb = supabaseAdmin();
  const { data: a, error: e0 } = await sb.from("analyses").select("*").eq("id", analysis_id).single();
  if (e0 || !a) {
    return ctx.response(apiError(404, "NOT_FOUND", "analysis not found", { requestId: ctx.requestId }));
  }

  const scenario = scenario_slug ? SCENARIOS.find((s) => s.slug === scenario_slug) : undefined;
  const deadline = createProviderDeadline(req.signal);

  let scores: Awaited<ReturnType<typeof judge>>;
  try {
    scores = await judge({
      analysis: {
        summary: a.summary ?? "",
        severity: (a.severity ?? "SEV3") as "SEV1" | "SEV2" | "SEV3",
        severity_reasoning: a.severity_reasoning ?? "",
        root_causes: (a.root_causes as never) ?? [],
        investigation_checklist: (a.investigation_checklist as never) ?? [],
        mitigation_plan: (a.mitigation_plan as never) ?? [],
        customer_impact: a.customer_impact ?? "",
        postmortem_draft: a.postmortem_draft ?? "",
        follow_ups: (a.follow_ups as never) ?? [],
      },
      scenario,
    }, undefined, { abortSignal: deadline.signal });
  } catch (err) {
    const failure = classifyProviderDeadlineFailure(req.signal, deadline);
    if (failure === "request_aborted") {
      ctx.log("warn", "evaluation_request_aborted", { analysis_id });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Evaluation was cancelled.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "evaluation_provider_failed", { error: safeErrorDetail(err), analysis_id });
    if (failure === "timed_out") {
      return ctx.response(apiError(504, "EVALUATION_TIMEOUT", `Evaluation timed out after ${PROVIDER_TIMEOUT_MS / 1000}s.`, { requestId: ctx.requestId }));
    }
    return ctx.response(apiError(502, "JUDGE_ERROR", "Evaluation provider failed. Please try again.", { requestId: ctx.requestId }));
  }

  const overall = overallScore(scores);
  const { data: row, error: e1 } = await sb
    .from("evaluations")
    .insert({
      analysis_id,
      rubric_version: RUBRIC_VERSION,
      scores,
      overall,
      judge_model: JUDGE_MODEL,
      judge_notes: scores.overall_notes,
    })
    .select("id")
    .single();
  if (e1 || !row) {
    ctx.log("error", "evaluation_insert_failed", {
      error: safeErrorDetail(e1 ?? new Error("Evaluation insert returned no row.")),
      analysis_id,
    });
    return ctx.response(apiError(500, "DB_ERROR", "Could not save the evaluation.", { requestId: ctx.requestId }));
  }
  return ctx.response(NextResponse.json({ evaluation_id: row.id, overall, scores }), {
    analysis_id,
    evaluation_id: row.id,
    overall,
  });
}
