import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type PromptVersion } from "@/lib/prompts";
import { SCENARIOS } from "@/lib/scenarios";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { calcCost, normalizeUsage } from "@/lib/cost";
import { embed, buildSignature } from "@/lib/embeddings";
import { retrieveContext, formatChunksForPrompt, recordRetrievedChunks } from "@/lib/kb";
import { apiError } from "@/lib/http";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { classifyProviderDeadlineFailure, createProviderDeadline, PROVIDER_TIMEOUT_MS } from "@/lib/providerDeadline";
import { buildAnalysisRecord } from "@/lib/analysisRecord";
import { buildIncidentRecord } from "@/lib/incidentRecord";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = createRequestContext(req, "run_scenario");
  const { slug } = await params;
  const url = new URL(req.url);
  const requested = url.searchParams.get("version");
  const version: PromptVersion = requested === "v1" || requested === "v2" || requested === "v3" ? requested : DEFAULT_PROMPT_VERSION;
  const langParam = url.searchParams.get("language");
  const language: "en" | "zh" = langParam === "zh" ? "zh" : "en";
  if (!process.env.DEEPSEEK_API_KEY) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY not set", { requestId: ctx.requestId }));
  }
  if (!hasSupabase()) {
    return ctx.response(apiError(503, "DB_UNCONFIGURED", "Supabase not configured", { requestId: ctx.requestId }));
  }
  const rl = await rateLimit(clientKey(req));
  if (!rl.allowed) {
    return ctx.response(withRateLimitHeaders(apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s`, { requestId: ctx.requestId }), rl));
  }
  const scenario = SCENARIOS.find((s) => s.slug === slug);
  if (!scenario) {
    return ctx.response(apiError(404, "NOT_FOUND", "scenario not found", { requestId: ctx.requestId }));
  }

  const started = Date.now();
  const deadline = createProviderDeadline(req.signal);
  const queryText = [scenario.title, scenario.service, scenario.symptoms, scenario.context].filter(Boolean).join(" ").slice(0, 4000);
  const retrieved = await retrieveContext(queryText, { limit: 5, abortSignal: deadline.signal });
  const internal_context = formatChunksForPrompt(retrieved.chunks);
  let object;
  let tokens_in = 0;
  let tokens_out = 0;
  try {
    const result = await generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: getSystemPrompt(version),
      prompt: buildUserPrompt({
        service: scenario.service,
        symptoms: scenario.symptoms,
        raw_context: scenario.context,
        language,
        internal_context,
      }),
      temperature: 0.2,
      abortSignal: deadline.signal,
    });
    object = result.object;
    ({ tokens_in, tokens_out } = normalizeUsage(result.usage));
  } catch (err) {
    ctx.log("error", "scenario_provider_failed", { error: safeErrorDetail(err), scenario_slug: slug });
    const failure = classifyProviderDeadlineFailure(req.signal, deadline);
    if (failure === "request_aborted") {
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Scenario analysis was cancelled.", { requestId: ctx.requestId }));
    }
    if (failure === "timed_out") {
      return ctx.response(apiError(504, "ANALYSIS_TIMEOUT", `Analysis timed out after ${PROVIDER_TIMEOUT_MS / 1000}s.`, { requestId: ctx.requestId }));
    }
    return ctx.response(apiError(502, "LLM_ERROR", "Analysis provider failed. Please try again.", { requestId: ctx.requestId }));
  }
  const latency = Date.now() - started;
  const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);

  const sb = supabaseAdmin();
  const signature = buildSignature({
    title: scenario.title,
    service: scenario.service,
    symptoms: scenario.symptoms,
    summary: object.summary,
    severity: object.severity,
  });
  const embedding = await embed(signature, deadline.signal);
  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert(buildIncidentRecord({
      title: `[Scenario] ${scenario.title}`,
      service: scenario.service,
      symptoms: scenario.symptoms,
      rawContext: scenario.context,
      signature,
      embedding,
    }))
    .select("id")
    .single();
  if (e1) {
    ctx.log("error", "scenario_incident_insert_failed", { error: safeErrorDetail(e1), scenario_slug: slug });
    return ctx.response(apiError(500, "DB_ERROR", "Could not save the scenario run.", { requestId: ctx.requestId }));
  }

  const { data: anaRow, error: e2 } = await sb.from("analyses").insert(
    buildAnalysisRecord({
      incidentId: inc.id,
      analysis: object,
      model: ANALYSIS_MODEL,
      promptVersion: version,
      outputLanguage: language,
      latencyMs: latency,
      usage: { tokens_in, tokens_out, cost_usd },
    }),
  ).select("id").single();
  if (e2 || !anaRow) {
    const { error: cleanupError } = await sb.from("incidents").delete().eq("id", inc.id);
    ctx.log("error", "scenario_analysis_insert_failed", {
      error: safeErrorDetail(e2 ?? new Error("Analysis insert returned no row.")),
      cleanup_error: cleanupError ? safeErrorDetail(cleanupError) : undefined,
      incident_id: inc.id,
      scenario_slug: slug,
    });
    return ctx.response(apiError(500, "DB_ERROR", "Could not save the scenario analysis.", { requestId: ctx.requestId }));
  }
  await recordRetrievedChunks(anaRow.id, retrieved.chunks);

  return ctx.response(NextResponse.json({ incident_id: inc.id, latency_ms: latency }), {
    incident_id: inc.id,
    scenario_slug: slug,
    prompt_version: version,
    output_language: language,
  });
}
