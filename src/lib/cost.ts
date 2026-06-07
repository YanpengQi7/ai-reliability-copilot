// Pricing (USD per 1M tokens). DeepSeek from platform.deepseek.com as of 2026-02;
// OpenAI from openai.com/api/pricing as of 2026-02 — update when prices change.
// OpenAI entries exist so the cross-model judge (run-evals-crossjudge.ts) can
// report cost-per-judge alongside agreement. Bare ids are looked up directly;
// the cross-judge script strips the "openai:" prefix before calling calcCost.
const MODEL_PRICING: Record<string, { input_per_M: number; output_per_M: number }> = {
  "deepseek-chat": { input_per_M: 0.27, output_per_M: 1.10 },
  "deepseek-reasoner": { input_per_M: 0.55, output_per_M: 2.19 },
  "gpt-4o-mini": { input_per_M: 0.15, output_per_M: 0.60 },
  "gpt-4.1-mini": { input_per_M: 0.40, output_per_M: 1.60 },
};

/**
 * Calculate USD cost of an LLM call.
 * Returns null if model is unknown so we don't lie with a $0 default.
 */
export function calcCost(model: string, tokens_in: number, tokens_out: number): number | null {
  const p = MODEL_PRICING[model];
  if (!p) return null;
  return (tokens_in * p.input_per_M + tokens_out * p.output_per_M) / 1_000_000;
}

/**
 * Normalize the AI SDK's usage shape across `generateObject`, `streamObject`,
 * and `generateText`. Different versions of the SDK have used:
 *   - { promptTokens, completionTokens, totalTokens }     (v3-)
 *   - { inputTokens, outputTokens, totalTokens }           (v4+)
 */
type AnyUsage = {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined;

export function normalizeUsage(usage: AnyUsage): { tokens_in: number; tokens_out: number } {
  if (!usage) return { tokens_in: 0, tokens_out: 0 };
  return {
    tokens_in: usage.inputTokens ?? usage.promptTokens ?? 0,
    tokens_out: usage.outputTokens ?? usage.completionTokens ?? 0,
  };
}
