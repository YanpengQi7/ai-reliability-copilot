// Webhook receiver: Datadog / PagerDuty / Sentry → automatic incident + analysis.
//
// Set up in the alerter:
//   Datadog:    integrations → webhooks → URL: https://<your-app>/api/webhook/alert
//               Custom payload: ship raw alert JSON (any fields they support)
//   PagerDuty:  extensions → webhook v3 → URL above
//   Sentry:     integrations → webhooks → URL above (issue alerts)
//
// Auth (optional, env-gated):
//   WEBHOOK_SECRET set → require Authorization: Bearer <token> or
//                        X-Webhook-Secret. Query tokens require an explicit
//                        legacy opt-in because URLs are commonly logged.
//   unset → public (don't do this on prod)
//
// Response pattern (fast ACK):
//   We persist the incident row + parsed context immediately (~50ms),
//   respond 202 with the incident URL, then run the LLM analysis in the
//   background via `after()`. The alerter sees a quick green check; the
//   analysis appears at the URL within ~15s.

import { NextResponse, after } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { tryParseAlert } from "@/lib/alertParsers";
import { calcCost, normalizeUsage } from "@/lib/cost";
import { embed, embeddingForDatabase, buildSignature } from "@/lib/embeddings";
import { retrieveContext, formatChunksForPrompt, recordRetrievedChunks } from "@/lib/kb";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { apiError } from "@/lib/http";
import { INPUT_LIMITS, machineEndpointNeedsSecret, readTextBody, redactSensitiveValue } from "@/lib/requestSafety";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { bearerToken, secureTokenEqual } from "@/lib/serverAuth";
import { createProviderDeadline, PROVIDER_TIMEOUT_MS } from "@/lib/providerDeadline";
import { buildAnalysisRecord } from "@/lib/analysisRecord";
import { buildIncidentRecord } from "@/lib/incidentRecord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RATE_LIMIT = 60;

function checkAuth(req: Request): boolean {
  const required = process.env.WEBHOOK_SECRET;
  if (!required) return true;
  const fromHeader = bearerToken(req) ?? req.headers.get("x-webhook-secret");
  if (secureTokenEqual(fromHeader, required)) return true;
  if (process.env.ALLOW_LEGACY_QUERY_SECRET !== "true") return false;
  return secureTokenEqual(new URL(req.url).searchParams.get("secret"), required);
}

export async function POST(req: Request) {
  const ctx = createRequestContext(req, "webhook_alert");
  if (machineEndpointNeedsSecret(process.env.WEBHOOK_SECRET)) {
    return ctx.response(apiError(503, "AUTH_NOT_CONFIGURED", "WEBHOOK_SECRET is required in production.", { requestId: ctx.requestId }));
  }
  if (!checkAuth(req)) {
    return ctx.response(apiError(401, "UNAUTHORIZED", "Missing or wrong secret", { requestId: ctx.requestId }));
  }
  const rl = await rateLimit(clientKey(req), { max: RATE_LIMIT, namespace: "webhook" });
  if (!rl.allowed) {
    return ctx.response(withRateLimitHeaders(apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s`, { requestId: ctx.requestId }), rl));
  }
  if (!hasSupabase()) {
    return ctx.response(apiError(503, "DB_UNCONFIGURED", "Supabase env missing", { requestId: ctx.requestId }));
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY missing", { requestId: ctx.requestId }));
  }
  const bodyResult = await readTextBody(req, INPUT_LIMITS.rawContext);
  if (!bodyResult.ok) {
    return ctx.response(apiError(413, "PAYLOAD_TOO_LARGE", "Webhook payload is too large.", { requestId: ctx.requestId }));
  }
  const bodyText = bodyResult.value;
  if (bodyText.length < 5) {
    return ctx.response(apiError(400, "EMPTY_BODY", "Webhook body empty", { requestId: ctx.requestId }));
  }

  const parsed = redactSensitiveValue(tryParseAlert(bodyText) ?? {
    source: "raw" as const,
    title: undefined,
    service: undefined,
    symptoms: undefined,
    raw_context: bodyText.slice(0, 8000), // truncate hostile / huge payloads
  });

  const sb = supabaseAdmin();

  // 1. Insert the incident IMMEDIATELY so the webhook caller gets a fast ACK
  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert(buildIncidentRecord({
      title: parsed.title ? `[${parsed.source}] ${parsed.title}` : `[${parsed.source}] webhook`,
      service: parsed.service,
      symptoms: parsed.symptoms,
      rawContext: parsed.raw_context,
    }))
    .select("id")
    .single();
  if (e1) {
    ctx.log("error", "webhook_incident_insert_failed", { error: safeErrorDetail(e1) });
    return ctx.response(apiError(500, "DB_ERROR", "Could not record the incident.", { requestId: ctx.requestId }));
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://ai-reliability-copilot.vercel.app";
  const url = `${base}/incidents/${inc.id}`;

  // 2. Schedule analysis to run AFTER the response is sent
  after(async () => {
    const deadline = createProviderDeadline();
    try {
      const queryText = [parsed.title, parsed.service, parsed.symptoms, parsed.raw_context]
        .filter(Boolean).join(" ").slice(0, 4000);
      const retrieved = await retrieveContext(queryText, { limit: 5, abortSignal: deadline.signal });
      const internal_context = formatChunksForPrompt(retrieved.chunks);

      const started = Date.now();
      const { object, usage } = await generateObject({
        model: deepseek(ANALYSIS_MODEL),
        schema: AnalysisSchema,
        system: getSystemPrompt(DEFAULT_PROMPT_VERSION),
        prompt: buildUserPrompt({
          service: parsed.service,
          symptoms: parsed.symptoms,
          raw_context: parsed.raw_context,
          language: "en",
          internal_context,
        }),
        temperature: 0.2,
        abortSignal: deadline.signal,
      });
      const latency_ms = Date.now() - started;
      const { tokens_in, tokens_out } = normalizeUsage(usage);
      const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);

      // Also compute signature + embedding now that we have the LLM summary
      const signature = buildSignature({
        title: parsed.title,
        service: parsed.service,
        symptoms: parsed.symptoms,
        summary: object.summary,
        severity: object.severity,
      });
      const embedding = await embed(signature, deadline.signal);
      await sb.from("incidents").update({
        signature,
        embedding: embeddingForDatabase(embedding),
      }).eq("id", inc.id);

      const { data: anaRow, error: e2 } = await sb.from("analyses").insert(
        buildAnalysisRecord({
          incidentId: inc.id,
          analysis: object,
          model: ANALYSIS_MODEL,
          promptVersion: DEFAULT_PROMPT_VERSION,
          outputLanguage: "en",
          latencyMs: latency_ms,
          usage: { tokens_in, tokens_out, cost_usd },
        }),
      ).select("id").single();
      if (e2) {
        ctx.log("error", "webhook_analysis_insert_failed", {
          incident_id: inc.id,
          error: safeErrorDetail(e2),
        });
        throw e2;
      }
      if (anaRow) await recordRetrievedChunks(anaRow.id, retrieved.chunks);
      ctx.log("info", "webhook_analysis_completed", {
        incident_id: inc.id,
        analysis_id: anaRow?.id,
        latency_ms,
        tokens_in,
        tokens_out,
      });
    } catch (err) {
      ctx.log("error", "webhook_background_failed", {
        incident_id: inc.id,
        error: safeErrorDetail(err),
        timed_out: deadline.timeoutSignal.aborted,
        ...(deadline.timeoutSignal.aborted ? { timeout_ms: PROVIDER_TIMEOUT_MS } : {}),
      });
      // Don't lose the failure — log it on the incident itself so /incidents/[id] shows it
      try {
        await sb.from("analyses").insert({
          incident_id: inc.id,
          model: ANALYSIS_MODEL,
          prompt_version: DEFAULT_PROMPT_VERSION,
          output_language: "en",
          summary: `Background analysis failed. Request ID: ${ctx.requestId}`,
          severity: "SEV3",
          root_causes: [],
          investigation_checklist: [],
          mitigation_plan: [],
          customer_impact: "n/a",
          postmortem_draft: "n/a",
          follow_ups: [],
        });
      } catch { /* swallow — we tried */ }
    }
  });

  return ctx.response(
    NextResponse.json({
      status: "accepted",
      source: parsed.source,
      incident_id: inc.id,
      url,
      message: "Incident recorded. Analysis will appear at url within ~15s.",
    }, { status: 202 }),
    { source: parsed.source, incident_id: inc.id },
  );
}
