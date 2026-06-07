import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AnalysisSchema } from "@/lib/schema";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { ANALYSIS_MODEL } from "@/lib/ai";
import { DEFAULT_PROMPT_VERSION } from "@/lib/prompts";
import { embed, buildSignature } from "@/lib/embeddings";
import { retrieveContext, recordRetrievedChunks } from "@/lib/kb";

export const runtime = "nodejs";

const Body = z.object({
  title: z.string().optional(),
  service: z.string().optional(),
  symptoms: z.string().optional(),
  raw_context: z.string().min(20),
  analysis: AnalysisSchema,
  latency_ms: z.number().optional(),
  prompt_version: z.enum(["v1", "v2", "v3"]).optional(),
  output_language: z.enum(["en", "zh"]).optional(),
  // Token usage captured from the streaming /api/analyze response trailer.
  // Optional — older clients / the CLI/webhook paths may omit it.
  usage: z
    .object({
      tokens_in: z.number().int().nonnegative(),
      tokens_out: z.number().int().nonnegative(),
      cost_usd: z.number().nullable(),
    })
    .optional(),
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

  // Build similarity-search artifacts. Both are best-effort: a failure here
  // must not block the incident write (analysis succeeded, that's the contract).
  const signature = buildSignature({
    title: input.title,
    service: input.service,
    symptoms: input.symptoms,
    summary: input.analysis.summary,
    severity: input.analysis.severity,
  });
  const embedding = await embed(signature); // null when no OPENAI_API_KEY or on failure

  const { data: inc, error: e1 } = await sb
    .from("incidents")
    .insert({
      title: input.title ?? null,
      service: input.service ?? null,
      symptoms: input.symptoms ?? null,
      raw_context: input.raw_context,
      signature,
      embedding: embedding ? (embedding as unknown as string) : null,
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
      tokens_in: input.usage?.tokens_in ?? null,
      tokens_out: input.usage?.tokens_out ?? null,
      cost_usd: input.usage?.cost_usd ?? null,
    })
    .select("id")
    .single();
  if (e2) return NextResponse.json({ error: "DB_ERROR", message: e2.message, statusCode: 500 }, { status: 500 });

  // Record which KB chunks the streaming /api/analyze pipeline retrieved.
  // We re-run retrieval with the same query so the junction is consistent
  // — slight cost (1 extra embed call), but the audit trail is now complete.
  try {
    const queryText = [input.title, input.service, input.symptoms, input.raw_context].filter(Boolean).join(" ").slice(0, 4000);
    const r = await retrieveContext(queryText, { limit: 5 });
    await recordRetrievedChunks(ana.id, r.chunks);
  } catch (err) {
    console.error("[save] recordRetrievedChunks failed:", err);
  }

  return NextResponse.json({ incident_id: inc.id, analysis_id: ana.id });
}
