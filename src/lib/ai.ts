import { createDeepSeek, type DeepSeekProvider } from "@ai-sdk/deepseek";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";

// Deferred init — do NOT capture process.env at module load.
// In Next.js routes, env vars are loaded before route execution.
// In tsx scripts, dotenv runs AFTER ES-module imports are hoisted, so we
// must read process.env lazily inside the provider factory.
let _deepseek: DeepSeekProvider | null = null;
function getProvider(): DeepSeekProvider {
  if (_deepseek) return _deepseek;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  _deepseek = createDeepSeek({ apiKey: apiKey ?? "" });
  return _deepseek;
}

// Plain function wrapper. ES-module callers do `deepseek(modelId)` — this
// resolves the provider on first call.
export function deepseek(modelId: string) {
  return getProvider()(modelId);
}

// Second provider, used for the cross-model judge (see scripts/run-evals-crossjudge.ts).
// Same lazy-init contract as the DeepSeek provider above.
let _openai: OpenAIProvider | null = null;
function getOpenAI(): OpenAIProvider {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  _openai = createOpenAI({ apiKey: apiKey ?? "" });
  return _openai;
}

export function openai(modelId: string) {
  return getOpenAI()(modelId);
}

// Third provider, also usable as the cross-model judge (Claude is a strong,
// genuinely independent judge). Same lazy-init contract.
let _anthropic: AnthropicProvider | null = null;
function getAnthropic(): AnthropicProvider {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Pin the baseURL — this provider version otherwise resolves to
  // api.anthropic.com/messages (missing the /v1 prefix → 404).
  _anthropic = createAnthropic({ apiKey: apiKey ?? "", baseURL: "https://api.anthropic.com/v1" });
  return _anthropic;
}

export function anthropic(modelId: string) {
  return getAnthropic()(modelId);
}

// Resolve a "provider:model" spec to an AI SDK model.
// A bare id (no ":") defaults to DeepSeek — back-compat with the historical
// single-provider config (JUDGE_MODEL = "deepseek-chat" still works unchanged).
//   resolveModel("deepseek-chat")              → DeepSeek deepseek-chat
//   resolveModel("openai:gpt-4o-mini")         → OpenAI gpt-4o-mini
//   resolveModel("anthropic:claude-sonnet-4-6")→ Anthropic Claude Sonnet 4.6
export function resolveModel(spec: string) {
  const idx = spec.indexOf(":");
  const [provider, modelId] =
    idx === -1 ? ["deepseek", spec] : [spec.slice(0, idx), spec.slice(idx + 1)];
  switch (provider) {
    case "deepseek":
      return deepseek(modelId);
    case "openai":
      return openai(modelId);
    case "anthropic":
      return anthropic(modelId);
    default:
      throw new Error(
        `Unknown provider "${provider}" in model spec "${spec}". Use "deepseek:<id>", "openai:<id>", or "anthropic:<id>".`,
      );
  }
}

export const ANALYSIS_MODEL = "deepseek-chat";
export const JUDGE_MODEL = "deepseek-chat";
// Grounding is graded by a stronger (reasoning) judge. Calibration showed
// deepseek-chat returns a flat 5.00 with zero variance on evidence_grounding —
// it can't discriminate verbatim-grounded from derived claims even with tightened
// anchors. deepseek-reasoner produces real variance that tracks the deterministic
// grounded-ratio check. See notes/calib-grounding-findings.md. The core-5 eval
// keeps JUDGE_MODEL for comparability with the historical single-shot evals.
export const JUDGE_MODEL_GROUNDING = "deepseek-reasoner";

// Independent cross-model judge. The core eval has DeepSeek judging DeepSeek,
// so its absolute scores carry a same-family optimistic bias (EVALUATION.md).
// This is a DIFFERENT vendor used to MEASURE that bias, not to replace the
// primary judge — see scripts/run-evals-crossjudge.ts. Override with
// JUDGE_MODEL_CROSS in .env.local (e.g. "openai:gpt-4.1-mini").
export const JUDGE_MODEL_CROSS = process.env.JUDGE_MODEL_CROSS ?? "openai:gpt-4o-mini";
