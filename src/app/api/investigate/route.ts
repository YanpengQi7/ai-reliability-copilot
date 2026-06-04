import { NextRequest } from "next/server";
import { z } from "zod";
import { investigate } from "@/lib/agent/investigate";
import { rateLimit, clientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 300;

// Agentic investigation endpoint. Unlike /api/analyze (single streamed call),
// this runs the hand-written tool-use loop and returns the full result —
// analysis + the investigation trace + usage — as one JSON payload. No DB
// writes (pure inference, same separation-of-concerns as /api/analyze).
const InputSchema = z.object({
  title: z.string().optional(),
  service: z.string().optional(),
  symptoms: z.string().optional(),
  raw_context: z.string().min(20, "raw_context too short — paste real incident details").optional(),
  scenario_slug: z.string().optional(),
  output_language: z.enum(["en", "zh"]).optional(),
  max_steps: z.number().int().min(1).max(12).optional(),
}).refine((d) => d.raw_context || d.scenario_slug, {
  message: "Provide either raw_context or scenario_slug",
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
  // Agentic runs make several model calls — keep the demo limit tight.
  const rl = rateLimit(clientKey(req), { max: 3, windowMs: 60_000, namespace: "investigate" });
  if (!rl.allowed) {
    return jsonError(429, "RATE_LIMITED", `Demo limit: 3 investigations/min. Retry in ${rl.retryAfterSec}s.`);
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

  try {
    const result = await investigate({
      input: {
        service: input.service,
        symptoms: input.symptoms,
        raw_context: input.raw_context ?? "",
        scenarioSlug: input.scenario_slug,
      },
      language: input.output_language ?? "en",
      maxSteps: input.max_steps,
    });
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(500, "INVESTIGATION_FAILED", msg);
  }
}
