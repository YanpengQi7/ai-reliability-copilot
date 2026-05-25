import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { SYSTEM_PROMPT_V1, buildUserPrompt, PROMPT_VERSION } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    const { object } = await generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: SYSTEM_PROMPT_V1,
      prompt: buildUserPrompt({
        service: incident.service ?? undefined,
        symptoms: incident.symptoms ?? undefined,
        raw_context: incident.raw_context,
      }),
      temperature: 0.2,
    });
    const latency = Date.now() - started;
    const { error: e1 } = await sb.from("analyses").insert({
      incident_id: id,
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
    if (e1) throw e1;
    return NextResponse.json({ ok: true, latency_ms: latency });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "LLM_ERROR", message: msg, statusCode: 502 }, { status: 502 });
  }
}
