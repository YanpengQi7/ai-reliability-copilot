import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type PromptVersion } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { calcCost, normalizeUsage } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const requested = url.searchParams.get("version");
  const version: PromptVersion = requested === "v1" || requested === "v2" ? requested : DEFAULT_PROMPT_VERSION;
  const langParam = url.searchParams.get("language");
  const language: "en" | "zh" = langParam === "zh" ? "zh" : "en";
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "MISSING_API_KEY", message: "DEEPSEEK_API_KEY not set", statusCode: 503 }, { status: 503 });
  }
  if (!hasSupabase()) {
    return NextResponse.json({ error: "DB_UNCONFIGURED", message: "Supabase not configured", statusCode: 503 }, { status: 503 });
  }
  const sb = supabaseAdmin();
  const { data: incident, error: e0 } = await sb.from("incidents").select("*").eq("id", id).single();
  if (e0 || !incident) {
    return NextResponse.json({ error: "NOT_FOUND", message: "incident not found", statusCode: 404 }, { status: 404 });
  }

  const started = Date.now();
  try {
    const { object, usage } = await generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: getSystemPrompt(version),
      prompt: buildUserPrompt({
        service: incident.service ?? undefined,
        symptoms: incident.symptoms ?? undefined,
        raw_context: incident.raw_context,
        language,
      }),
      temperature: 0.2,
    });
    const latency = Date.now() - started;
    const { tokens_in, tokens_out } = normalizeUsage(usage);
    const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);
    const { error: e1 } = await sb.from("analyses").insert({
      incident_id: id,
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
    });
    if (e1) throw e1;
    return NextResponse.json({ ok: true, latency_ms: latency });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "LLM_ERROR", message: msg, statusCode: 502 }, { status: 502 });
  }
}
