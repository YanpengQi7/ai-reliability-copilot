import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { SYSTEM_PROMPT_V1, buildUserPrompt, PROMPT_VERSION } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const InputSchema = z.object({
  title: z.string().optional(),
  service: z.string().optional(),
  symptoms: z.string().optional(),
  raw_context: z.string().min(20, "raw_context too short — paste real incident details"),
  persist: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body must be JSON", statusCode: 400 }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: parsed.error.message, statusCode: 400 },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const started = Date.now();
  let analysis;
  try {
    const result = await generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: SYSTEM_PROMPT_V1,
      prompt: buildUserPrompt(input),
      temperature: 0.2,
    });
    analysis = result.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "LLM_ERROR", message: msg, statusCode: 502 },
      { status: 502 }
    );
  }
  const latency_ms = Date.now() - started;

  // Optionally persist to Supabase. If env vars not set yet, just return analysis.
  let incident_id: string | null = null;
  let analysis_id: string | null = null;
  if (input.persist && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sb = supabaseAdmin();
      const { data: inc, error: incErr } = await sb
        .from("incidents")
        .insert({
          title: input.title ?? null,
          service: input.service ?? null,
          symptoms: input.symptoms ?? null,
          raw_context: input.raw_context,
        })
        .select("id")
        .single();
      if (incErr) throw incErr;
      incident_id = inc.id;

      const { data: ana, error: anaErr } = await sb
        .from("analyses")
        .insert({
          incident_id,
          model: ANALYSIS_MODEL,
          prompt_version: PROMPT_VERSION,
          summary: analysis.summary,
          severity: analysis.severity,
          root_causes: analysis.root_causes,
          investigation_checklist: analysis.investigation_checklist,
          mitigation_plan: analysis.mitigation_plan,
          customer_impact: analysis.customer_impact,
          postmortem_draft: analysis.postmortem_draft,
          follow_ups: analysis.follow_ups,
          latency_ms,
        })
        .select("id")
        .single();
      if (anaErr) throw anaErr;
      analysis_id = ana.id;
    } catch (err) {
      // Persistence is best-effort on Day 1 — don't fail the request.
      console.error("[analyze] persist failed:", err);
    }
  }

  return NextResponse.json({
    incident_id,
    analysis_id,
    prompt_version: PROMPT_VERSION,
    model: ANALYSIS_MODEL,
    latency_ms,
    analysis,
  });
}
