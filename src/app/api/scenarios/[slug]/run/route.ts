import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { SYSTEM_PROMPT_V1, buildUserPrompt, PROMPT_VERSION } from "@/lib/prompts";
import { SCENARIOS } from "@/lib/scenarios";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
  let object;
  try {
    const result = await generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: SYSTEM_PROMPT_V1,
      prompt: buildUserPrompt({
        service: scenario.service,
        symptoms: scenario.symptoms,
        raw_context: scenario.context,
      }),
      temperature: 0.2,
    });
    object = result.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "LLM_ERROR", message: msg, statusCode: 502 }, { status: 502 });
  }
  const latency = Date.now() - started;

  const sb = supabaseAdmin();
  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert({
      title: `[Scenario] ${scenario.title}`,
      service: scenario.service,
      symptoms: scenario.symptoms,
      raw_context: scenario.context,
    })
    .select("id")
    .single();
  if (e1) return NextResponse.json({ error: "DB_ERROR", message: e1.message, statusCode: 500 }, { status: 500 });

  await sb.from("analyses").insert({
    incident_id: inc.id,
    model: ANALYSIS_MODEL,
    prompt_version: PROMPT_VERSION,
    summary: object.summary,
    severity: object.severity,
    root_causes: object.root_causes,
    investigation_checklist: object.investigation_checklist,
    mitigation_plan: object.mitigation_plan,
    customer_impact: object.customer_impact,
    postmortem_draft: object.postmortem_draft,
    follow_ups: object.follow_ups,
    latency_ms: latency,
  });

  return NextResponse.json({ incident_id: inc.id, latency_ms: latency });
}
