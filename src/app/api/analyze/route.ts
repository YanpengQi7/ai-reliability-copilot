import { NextRequest } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type PromptVersion } from "@/lib/prompts";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { retrieveContext, formatChunksForPrompt } from "@/lib/kb";
import { normalizeUsage, calcCost } from "@/lib/cost";
import { usageTrailer } from "@/lib/streamUsage";
import { apiError, validationError, invalidJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

const InputSchema = z.object({
  title: z.string().optional(),
  service: z.string().optional(),
  symptoms: z.string().optional(),
  raw_context: z.string().min(20, "raw_context too short — paste real incident details"),
  prompt_version: z.enum(["v1", "v2", "v3"]).optional(),
  output_language: z.enum(["en", "zh"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return apiError(503, "MISSING_API_KEY", "DEEPSEEK_API_KEY is not configured on the server.");
  }
  const rl = rateLimit(clientKey(req));
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", `Demo limit: 5 requests/min. Retry in ${rl.retryAfterSec}s.`);
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
  const input = parsed.data;

  const version: PromptVersion = input.prompt_version ?? DEFAULT_PROMPT_VERSION;

  // RAG: retrieve relevant internal docs based on what the user typed.
  // Best-effort — if KB is empty or retrieval fails, we still produce a response.
  const queryText = [input.title, input.service, input.symptoms, input.raw_context].filter(Boolean).join(" ").slice(0, 4000);
  const retrieved = await retrieveContext(queryText, { limit: 5 });
  const internal_context = formatChunksForPrompt(retrieved.chunks);

  const result = streamObject({
    model: deepseek(ANALYSIS_MODEL),
    schema: AnalysisSchema,
    system: getSystemPrompt(version),
    prompt: buildUserPrompt({ ...input, language: input.output_language ?? "en", internal_context }),
    temperature: 0.2,
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
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
