import { NextRequest } from "next/server";
import { streamObject } from "ai";
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

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: code, message, statusCode: status }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return jsonError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY is not configured on the server.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Body must be JSON");
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const input = parsed.data;

  const started = Date.now();
  const result = streamObject({
    model: deepseek(ANALYSIS_MODEL),
    schema: AnalysisSchema,
    system: SYSTEM_PROMPT_V1,
    prompt: buildUserPrompt(input),
    temperature: 0.2,
    onFinish: async ({ object }) => {
      if (!object) return;
      if (!input.persist) return;
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
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
          latency_ms: Date.now() - started,
        });
      } catch (err) {
        console.error("[analyze] persist failed:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}
