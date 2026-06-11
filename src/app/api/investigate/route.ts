import { NextRequest } from "next/server";
import { z } from "zod";
import { investigate } from "@/lib/agent/investigate";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { apiError, validationError, invalidJson } from "@/lib/http";
import { contentLengthExceeds, INPUT_LIMITS, redactSensitiveValue } from "@/lib/requestSafety";

export const runtime = "nodejs";
export const maxDuration = 300;

// Agentic investigation endpoint. Unlike /api/analyze (single streamed call),
// this runs the hand-written tool-use loop and returns the full result —
// analysis + the investigation trace + usage — as one JSON payload. No DB
// writes (pure inference, same separation-of-concerns as /api/analyze).
const InputSchema = z.object({
  title: z.string().max(INPUT_LIMITS.shortText).optional(),
  service: z.string().max(INPUT_LIMITS.shortText).optional(),
  symptoms: z.string().max(INPUT_LIMITS.shortText).optional(),
  raw_context: z.string().min(20, "raw_context too short — paste real incident details").max(INPUT_LIMITS.rawContext).optional(),
  scenario_slug: z.string().max(INPUT_LIMITS.shortText).optional(),
  output_language: z.enum(["en", "zh"]).optional(),
  max_steps: z.number().int().min(1).max(12).optional(),
}).refine((d) => d.raw_context || d.scenario_slug, {
  message: "Provide either raw_context or scenario_slug",
});

export async function POST(req: NextRequest) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY is not configured on the server.");
  }
  // Agentic runs make several model calls — keep the demo limit tight.
  const rl = rateLimit(clientKey(req), { max: 3, windowMs: 60_000, namespace: "investigate" });
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", `Demo limit: 3 investigations/min. Retry in ${rl.retryAfterSec}s.`);
  }
  if (contentLengthExceeds(req, INPUT_LIMITS.rawContext * 2)) {
    return apiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidJson();
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const input = redactSensitiveValue(parsed.data);

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
    return apiError(500, "INVESTIGATION_FAILED", msg);
  }
}
