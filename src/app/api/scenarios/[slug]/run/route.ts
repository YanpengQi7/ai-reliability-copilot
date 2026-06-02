import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type PromptVersion } from "@/lib/prompts";
import { SCENARIOS } from "@/lib/scenarios";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { calcCost, normalizeUsage } from "@/lib/cost";
import { embed, buildSignature } from "@/lib/embeddings";
import { retrieveContext, formatChunksForPrompt, recordRetrievedChunks } from "@/lib/kb";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const requested = url.searchParams.get("version");
  const version: PromptVersion = requested === "v1" || requested === "v2" || requested === "v3" ? requested : DEFAULT_PROMPT_VERSION;
  const langParam = url.searchParams.get("language");
  const language: "en" | "zh" = langParam === "zh" ? "zh" : "en";
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "MISSING_API_KEY", message: "DEEPSEEK_API_KEY not set", statusCode: 503 }, { status: 503 });
  }
  if (!hasSupabase()) {
    return NextResponse.json({ error: "DB_UNCONFIGURED", message: "Supabase not configured", statusCode: 503 }, { status: 503 });
  }
  const rl = rateLimit(clientKey(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED", message: `Retry in ${rl.retryAfterSec}s`, statusCode: 429 }, { status: 429 });
  }
  const scenario = SCENARIOS.find((s) => s.slug === slug);
  if (!scenario) {
    return NextResponse.json({ error: "NOT_FOUND", message: "scenario not found", statusCode: 404 }, { status: 404 });
  }

  const started = Date.now();
  const queryText = [scenario.title, scenario.service, scenario.symptoms, scenario.context].filter(Boolean).join(" ").slice(0, 4000);
  const retrieved = await retrieveContext(queryText, { limit: 5 });
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
    });
    object = result.object;
    ({ tokens_in, tokens_out } = normalizeUsage(result.usage));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "LLM_ERROR", message: msg, statusCode: 502 }, { status: 502 });
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
  const embedding = await embed(signature);
  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert({
      title: `[Scenario] ${scenario.title}`,
      service: scenario.service,
      symptoms: scenario.symptoms,
      raw_context: scenario.context,
      signature,
      embedding: embedding ? (embedding as unknown as string) : null,
    })
    .select("id")
    .single();
  if (e1) return NextResponse.json({ error: "DB_ERROR", message: e1.message, statusCode: 500 }, { status: 500 });

  const { data: anaRow } = await sb.from("analyses").insert({
    incident_id: inc.id,
    model: ANALYSIS_MODEL,
    prompt_version: version,
    output_language: language,
    summary: object.summary,
    severity: object.severity,
    severity_reasoning: object.severity_reasoning,
    root_causes: object.root_causes,
    investigation_checklist: object.investigation_checklist,
    mitigation_plan: object.mitigation_plan,
    customer_impact: object.customer_impact,
    postmortem_draft: object.postmortem_draft,
    follow_ups: object.follow_ups,
    latency_ms: latency,
    tokens_in,
    tokens_out,
    cost_usd,
  }).select("id").single();
  if (anaRow) await recordRetrievedChunks(anaRow.id, retrieved.chunks);

  return NextResponse.json({ incident_id: inc.id, latency_ms: latency });
}
