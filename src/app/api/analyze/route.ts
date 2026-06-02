import { NextRequest } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { AnalysisSchema } from "@/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type PromptVersion } from "@/lib/prompts";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { retrieveContext, formatChunksForPrompt } from "@/lib/kb";

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
  const rl = rateLimit(clientKey(req));
  if (!rl.allowed) {
    return jsonError(429, "RATE_LIMITED", `Demo limit: 5 requests/min. Retry in ${rl.retryAfterSec}s.`);
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

  // KNOWN LIMITATION: token usage is not captured on the streaming path.
  // `experimental_useObject` on the client doesn't expose usage, and the response
  // headers are already flushed by the time onFinish fires. The rerun, scenario-run,
  // and batch-eval paths (which use generateObject) do capture usage correctly.
  // Cost on this path is back-fillable via DeepSeek's usage export if needed.
  return result.toTextStreamResponse();
}
