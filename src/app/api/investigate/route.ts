import { NextRequest } from "next/server";
import { z } from "zod";
import { investigate } from "@/lib/agent/investigate";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { apiError } from "@/lib/http";
import { contentLengthExceeds, INPUT_LIMITS, redactSensitiveValue } from "@/lib/requestSafety";
import { createRequestContext } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 300;

const INVESTIGATION_TIMEOUT_MS = 240_000;

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
  const ctx = createRequestContext(req, "investigate");
  if (!process.env.DEEPSEEK_API_KEY) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY is not configured on the server.", { requestId: ctx.requestId }));
  }
  // Agentic runs make several model calls — keep the demo limit tight.
  const rl = rateLimit(clientKey(req), { max: 3, windowMs: 60_000, namespace: "investigate" });
  if (!rl.allowed) {
    return ctx.response(apiError(429, "RATE_LIMITED", `Demo limit: 3 investigations/min. Retry in ${rl.retryAfterSec}s.`, { requestId: ctx.requestId }));
  }
  if (contentLengthExceeds(req, INPUT_LIMITS.rawContext * 2)) {
    return ctx.response(apiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.", { requestId: ctx.requestId }));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ctx.response(apiError(400, "INVALID_JSON", "Body must be JSON", { requestId: ctx.requestId }));
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return ctx.response(apiError(400, "VALIDATION_ERROR", message, { requestId: ctx.requestId }));
  }
  const input = redactSensitiveValue(parsed.data);
  const timeoutSignal = AbortSignal.timeout(INVESTIGATION_TIMEOUT_MS);
  const signal = AbortSignal.any([req.signal, timeoutSignal]);

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
      abortSignal: signal,
    });
    return ctx.response(Response.json(result), {
      steps: result.steps,
      completed: result.completed,
      model_calls: result.usage.model_calls,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (req.signal.aborted) {
      ctx.log("warn", "investigation_request_aborted", { error: detail });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Investigation was cancelled.", { requestId: ctx.requestId }));
    }
    if (timeoutSignal.aborted) {
      ctx.log("error", "investigation_request_timed_out", {
        timeout_ms: INVESTIGATION_TIMEOUT_MS,
        error: detail,
      });
      return ctx.response(apiError(504, "INVESTIGATION_TIMEOUT", "Investigation timed out. Try fewer steps.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "investigation_failed", { error: detail });
    return ctx.response(apiError(502, "INVESTIGATION_FAILED", "Investigation provider failed. Please try again.", { requestId: ctx.requestId }));
  }
}
