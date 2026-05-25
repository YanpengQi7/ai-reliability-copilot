import { NextResponse } from "next/server";
import { z } from "zod";
import { judge } from "@/lib/eval/judge";
import { RUBRIC_VERSION, overallScore } from "@/lib/eval/rubric";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { JUDGE_MODEL } from "@/lib/ai";
import { SCENARIOS } from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  analysis_id: z.string().uuid(),
  scenario_slug: z.string().optional(),
});

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "MISSING_API_KEY", message: "DEEPSEEK_API_KEY not set", statusCode: 503 }, { status: 503 });
  }
  if (!hasSupabase()) {
    return NextResponse.json({ error: "DB_UNCONFIGURED", message: "Supabase not configured", statusCode: 503 }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: parsed.error.message, statusCode: 400 }, { status: 400 });
  }
  const { analysis_id, scenario_slug } = parsed.data;
  const sb = supabaseAdmin();
  const { data: a, error: e0 } = await sb.from("analyses").select("*").eq("id", analysis_id).single();
  if (e0 || !a) {
    return NextResponse.json({ error: "NOT_FOUND", message: "analysis not found", statusCode: 404 }, { status: 404 });
  }

  const scenario = scenario_slug ? SCENARIOS.find((s) => s.slug === scenario_slug) : undefined;

  try {
    const scores = await judge({
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
    });
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
    if (e1) throw e1;
    return NextResponse.json({ evaluation_id: row.id, overall, scores });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "JUDGE_ERROR", message: msg, statusCode: 502 }, { status: 502 });
  }
}
