import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { describeImage, hasVisionProvider } from "@/lib/vision";
import { apiError } from "@/lib/http";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { contentLengthExceeds, INPUT_LIMITS, isAllowedImageSource } from "@/lib/requestSafety";
import { createRequestContext } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const rl = rateLimit(clientKey(req), { max: 3, namespace: "vision" });
  if (!rl.allowed) {
    return ctx.response(apiError(429, "RATE_LIMITED", `Retry in ${rl.retryAfterSec}s.`, { requestId: ctx.requestId }));
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

  const description = await describeImage(parsed.data.image);
  if (!description) return ctx.response(apiError(502, "VISION_FAILED", "Vision call returned no content", { requestId: ctx.requestId }));
  return ctx.response(NextResponse.json({ description }));
}
