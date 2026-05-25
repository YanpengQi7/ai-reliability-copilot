import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AnalysisSchema } from "@/lib/schema";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { ANALYSIS_MODEL } from "@/lib/ai";
import { DEFAULT_PROMPT_VERSION } from "@/lib/prompts";

export const runtime = "nodejs";

const Body = z.object({
  title: z.string().optional(),
  service: z.string().optional(),
  symptoms: z.string().optional(),
  raw_context: z.string().min(20),
  analysis: AnalysisSchema,
  latency_ms: z.number().optional(),
  prompt_version: z.enum(["v1", "v2"]).optional(),
  output_language: z.enum(["en", "zh"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "DB_UNCONFIGURED", message: "Supabase env vars not set", statusCode: 503 }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body must be JSON", statusCode: 400 }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: parsed.error.message, statusCode: 400 }, { status: 400 });
  }
  const input = parsed.data;
  const sb = supabaseAdmin();
  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert({
      title: input.title ?? null,
      service: input.service ?? null,
      symptoms: input.symptoms ?? null,
      raw_context: input.raw_context,
    })
    .select("id")
    .single();
  if (e1) return NextResponse.json({ error: "DB_ERROR", message: e1.message, statusCode: 500 }, { status: 500 });

  const a = input.analysis;
  const { data: ana, error: e2 } = await sb
    .from("analyses")
    .insert({
      incident_id: inc.id,
      model: ANALYSIS_MODEL,
      prompt_version: input.prompt_version ?? DEFAULT_PROMPT_VERSION,
      output_language: input.output_language ?? "en",
      summary: a.summary,
      severity: a.severity,
      severity_reasoning: a.severity_reasoning,
      root_causes: a.root_causes,
      investigation_checklist: a.investigation_checklist,
      mitigation_plan: a.mitigation_plan,
      customer_impact: a.customer_impact,
      postmortem_draft: a.postmortem_draft,
      follow_ups: a.follow_ups,
      latency_ms: input.latency_ms ?? null,
    })
    .select("id")
    .single();
  if (e2) return NextResponse.json({ error: "DB_ERROR", message: e2.message, statusCode: 500 }, { status: 500 });

  return NextResponse.json({ incident_id: inc.id, analysis_id: ana.id });
}
