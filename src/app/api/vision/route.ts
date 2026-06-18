import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { describeImage, hasVisionProvider } from "@/lib/vision";
import { apiError } from "@/lib/http";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { contentLengthExceeds, INPUT_LIMITS, isAllowedImageSource } from "@/lib/requestSafety";
import { createRequestContext } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 60;

const VISION_TIMEOUT_MS = 45_000;

const Body = z.object({
  image: z.string()
    .min(20)
    .max(INPUT_LIMITS.imagePayload)
    .refine(isAllowedImageSource, "image must be a supported data URL or public HTTPS URL"),
});

export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, "vision");
  if (!hasVisionProvider()) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "OPENAI_API_KEY required for image analysis", { requestId: ctx.requestId }));
  }
  const rl = await rateLimit(clientKey(req), { max: 3, namespace: "vision" });
  if (!rl.allowed) {
    return ctx.response(withRateLimitHeaders(apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s.`, { requestId: ctx.requestId }), rl));
  }
  if (contentLengthExceeds(req, INPUT_LIMITS.imagePayload + 1024)) {
    return ctx.response(apiError(413, "PAYLOAD_TOO_LARGE", "Image payload is too large.", { requestId: ctx.requestId }));
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return ctx.response(apiError(400, "INVALID_JSON", "Body must be JSON", { requestId: ctx.requestId }));
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return ctx.response(apiError(400, "VALIDATION_ERROR", message, { requestId: ctx.requestId }));
  }

  const timeoutSignal = AbortSignal.timeout(VISION_TIMEOUT_MS);
  const signal = AbortSignal.any([req.signal, timeoutSignal]);

  try {
    const description = await describeImage(parsed.data.image, signal);
    if (!description) {
      return ctx.response(apiError(502, "VISION_FAILED", "Vision call returned no content", { requestId: ctx.requestId }));
    }
    return ctx.response(NextResponse.json({ description }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (req.signal.aborted) {
      ctx.log("warn", "vision_request_aborted", { error: detail });
      return ctx.response(apiError(499, "REQUEST_ABORTED", "Image analysis request was cancelled.", { requestId: ctx.requestId }));
    }
    if (timeoutSignal.aborted) {
      ctx.log("error", "vision_request_timed_out", {
        timeout_ms: VISION_TIMEOUT_MS,
        error: detail,
      });
      return ctx.response(apiError(504, "VISION_TIMEOUT", "Image analysis timed out. Please try again.", { requestId: ctx.requestId }));
    }
    ctx.log("error", "vision_provider_failed", { error: detail });
    return ctx.response(apiError(502, "VISION_FAILED", "Image analysis provider failed. Please try again.", { requestId: ctx.requestId }));
  }
}
