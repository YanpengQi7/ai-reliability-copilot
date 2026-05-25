// DeepSeek pricing (USD per 1M tokens). Sourced from platform.deepseek.com
// as of 2026-02 — update when DeepSeek changes prices.
const DEEPSEEK_PRICING: Record<string, { input_per_M: number; output_per_M: number }> = {
  "deepseek-chat": { input_per_M: 0.27, output_per_M: 1.10 },
  "deepseek-reasoner": { input_per_M: 0.55, output_per_M: 2.19 },
};

/**
 * Calculate USD cost of an LLM call.
 * Returns null if model is unknown so we don't lie with a $0 default.
 */
export function calcCost(model: string, tokens_in: number, tokens_out: number): number | null {
  const p = DEEPSEEK_PRICING[model];
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
