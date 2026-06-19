import { NextRequest } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type PromptVersion } from "@/lib/prompts";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { retrieveContext, formatChunksForPrompt } from "@/lib/kb";
import { normalizeUsage, calcCost } from "@/lib/cost";
import { usageTrailer } from "@/lib/streamUsage";
import { apiError } from "@/lib/http";
import { INPUT_LIMITS, readJsonBody, redactSensitiveValue } from "@/lib/requestSafety";
import { createRequestContext } from "@/lib/observability";
import { classifyProviderDeadlineFailure, createProviderDeadline, PROVIDER_TIMEOUT_MS } from "@/lib/providerDeadline";

export const runtime = "nodejs";
export const maxDuration = 300;

const InputSchema = z.object({
  title: z.string().max(INPUT_LIMITS.shortText).optional(),
  service: z.string().max(INPUT_LIMITS.shortText).optional(),
  symptoms: z.string().max(INPUT_LIMITS.shortText).optional(),
  raw_context: z.string().min(20, "raw_context too short — paste real incident details").max(INPUT_LIMITS.rawContext),
  prompt_version: z.enum(["v1", "v2", "v3"]).optional(),
  output_language: z.enum(["en", "zh"]).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, "analyze");
  if (!process.env.DEEPSEEK_API_KEY) {
    return ctx.response(apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY is not configured on the server.", { requestId: ctx.requestId }));
  }
  const rl = await rateLimit(clientKey(req));
  if (!rl.allowed) {
    return ctx.response(withRateLimitHeaders(apiError(429, "RATE_LIMITED", `Demo limit: 5 requests/min. Retry in ${rl.retryAfterSec}s.`, { requestId: ctx.requestId }), rl));
  }
  const bodyResult = await readJsonBody(req, INPUT_LIMITS.rawContext * 2);
  if (!bodyResult.ok && bodyResult.error === "payload_too_large") {
    return ctx.response(apiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.", { requestId: ctx.requestId }));
  }
  if (!bodyResult.ok) {
    return ctx.response(apiError(400, "INVALID_JSON", "Body must be JSON", { requestId: ctx.requestId }));
  }
  const parsed = InputSchema.safeParse(bodyResult.value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return ctx.response(apiError(400, "VALIDATION_ERROR", message, { requestId: ctx.requestId }));
  }
  const input = redactSensitiveValue(parsed.data);

  const version: PromptVersion = input.prompt_version ?? DEFAULT_PROMPT_VERSION;

  // RAG: retrieve relevant internal docs based on what the user typed.
  // Best-effort — if KB is empty or retrieval fails, we still produce a response.
  const deadline = createProviderDeadline(req.signal);
  const queryText = [input.title, input.service, input.symptoms, input.raw_context].filter(Boolean).join(" ").slice(0, 4000);
  const retrieved = await retrieveContext(queryText, { limit: 5, abortSignal: deadline.signal });
  const internal_context = formatChunksForPrompt(retrieved.chunks);

  const result = streamObject({
    model: deepseek(ANALYSIS_MODEL),
    schema: AnalysisSchema,
    system: getSystemPrompt(version),
    prompt: buildUserPrompt({ ...input, language: input.output_language ?? "en", internal_context }),
    temperature: 0.2,
    abortSignal: deadline.signal,
  });

  // Stream the object JSON, then append a usage TRAILER once the stream ends
  // (usage is only known at that point — too late for a response header). The
  // client's usage-capturing fetch strips the trailer before useObject parses
  // the JSON, then forwards the captured usage to /api/incidents/save. See
  // src/lib/streamUsage.ts for the wire format.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of result.textStream) {
          controller.enqueue(encoder.encode(delta));
        }
        const usage = await result.usage;
        const { tokens_in, tokens_out } = normalizeUsage(usage);
        const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);
        controller.enqueue(encoder.encode(usageTrailer({ tokens_in, tokens_out, cost_usd })));
        controller.close();
      } catch (err) {
        const failure = classifyProviderDeadlineFailure(req.signal, deadline);
        if (failure === "request_aborted") {
          ctx.log("warn", "analysis_request_aborted");
        } else if (failure === "timed_out") {
          ctx.log("error", "analysis_provider_timed_out", { timeout_ms: PROVIDER_TIMEOUT_MS });
        }
        controller.error(err);
      }
    },
  });

  return ctx.response(new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  }), { prompt_version: version, output_language: input.output_language ?? "en" });
}
