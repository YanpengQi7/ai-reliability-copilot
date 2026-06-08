// Webhook receiver: Datadog / PagerDuty / Sentry → automatic incident + analysis.
//
// Set up in the alerter:
//   Datadog:    integrations → webhooks → URL: https://<your-app>/api/webhook/alert
//               Custom payload: ship raw alert JSON (any fields they support)
//   PagerDuty:  extensions → webhook v3 → URL above
//   Sentry:     integrations → webhooks → URL above (issue alerts)
//
// Auth (optional, env-gated):
//   WEBHOOK_SECRET set → require ?secret=<token> in URL OR
//                        X-Webhook-Secret header
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
import { embed, buildSignature } from "@/lib/embeddings";
import { retrieveContext, formatChunksForPrompt, recordRetrievedChunks } from "@/lib/kb";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RATE_LIMIT = 60;

function checkAuth(req: Request): boolean {
  const required = process.env.WEBHOOK_SECRET;
  if (!required) return true;
  const fromHeader = req.headers.get("x-webhook-secret");
  if (fromHeader && fromHeader === required) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === required;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return apiError(401, "UNAUTHORIZED", "Missing or wrong secret");
  }
  const rl = rateLimit(clientKey(req), { max: RATE_LIMIT, namespace: "webhook" });
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s`);
  }
  if (!hasSupabase()) {
    return apiError(503, "DB_UNCONFIGURED", "Supabase env missing");
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY missing");
  }

  const bodyText = await req.text();
  if (bodyText.length < 5) {
    return apiError(400, "EMPTY_BODY", "Webhook body empty");
  }

  const parsed = tryParseAlert(bodyText) ?? {
    source: "raw" as const,
    title: undefined,
    service: undefined,
    symptoms: undefined,
    raw_context: bodyText.slice(0, 8000), // truncate hostile / huge payloads
  };

  const sb = supabaseAdmin();

  // 1. Insert the incident IMMEDIATELY so the webhook caller gets a fast ACK
  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert({
      title: parsed.title ? `[${parsed.source}] ${parsed.title}` : `[${parsed.source}] webhook`,
      service: parsed.service ?? null,
      symptoms: parsed.symptoms ?? null,
      raw_context: parsed.raw_context,
    })
    .select("id")
    .single();
  if (e1) return apiError(500, "DB_ERROR", e1.message);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://ai-reliability-copilot.vercel.app";
  const url = `${base}/incidents/${inc.id}`;

  // 2. Schedule analysis to run AFTER the response is sent
  after(async () => {
    try {
      const queryText = [parsed.title, parsed.service, parsed.symptoms, parsed.raw_context]
        .filter(Boolean).join(" ").slice(0, 4000);
      const retrieved = await retrieveContext(queryText, { limit: 5 });
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
      const embedding = await embed(signature);
      await sb.from("incidents").update({
        signature,
        embedding: embedding ? (embedding as unknown as string) : null,
      }).eq("id", inc.id);

      const { data: anaRow, error: e2 } = await sb.from("analyses").insert({
        incident_id: inc.id,
        model: ANALYSIS_MODEL,
        prompt_version: DEFAULT_PROMPT_VERSION,
        output_language: "en",
        summary: object.summary,
        severity: object.severity,
        severity_reasoning: object.severity_reasoning,
        root_causes: object.root_causes,
        investigation_checklist: object.investigation_checklist,
        mitigation_plan: object.mitigation_plan,
        customer_impact: object.customer_impact,
        postmortem_draft: object.postmortem_draft,
        follow_ups: object.follow_ups,
        latency_ms,
        tokens_in,
        tokens_out,
        cost_usd,
      }).select("id").single();
      if (e2) {
        console.error("[webhook] analysis insert failed:", e2.message);
        return;
      }
      if (anaRow) await recordRetrievedChunks(anaRow.id, retrieved.chunks);
    } catch (err) {
      console.error("[webhook] background analysis failed:", err instanceof Error ? err.message : err);
      // Don't lose the failure — log it on the incident itself so /incidents/[id] shows it
      try {
        await sb.from("analyses").insert({
          incident_id: inc.id,
          model: ANALYSIS_MODEL,
          prompt_version: DEFAULT_PROMPT_VERSION,
          output_language: "en",
          summary: `Background analysis failed: ${err instanceof Error ? err.message : String(err)}`,
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

  return NextResponse.json({
    status: "accepted",
    source: parsed.source,
    incident_id: inc.id,
    url,
    message: "Incident recorded. Analysis will appear at url within ~15s.",
  }, { status: 202 });
}
