import { DEFAULT_PROMPT_VERSION, type PromptVersion } from "../prompts";

export const DEFAULT_EVAL_REPEATS = 3;
export const MAX_EVAL_REPEATS = 20;

export function parseEvalRepeats(
  raw: string | undefined,
  defaultRepeats = DEFAULT_EVAL_REPEATS,
): number {
  const value = raw ?? String(defaultRepeats);
  if (!/^\d+$/.test(value)) {
    throw new Error(`EVAL_REPEATS must be an integer from 1 to ${MAX_EVAL_REPEATS}.`);
  }
  const repeats = Number(value);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > MAX_EVAL_REPEATS) {
    throw new Error(`EVAL_REPEATS must be an integer from 1 to ${MAX_EVAL_REPEATS}.`);
  }
  return repeats;
}

export function parseEvalPromptVersion(raw: string | undefined): PromptVersion {
  const value = raw ?? DEFAULT_PROMPT_VERSION;
  if (value !== "v1" && value !== "v2" && value !== "v3") {
    throw new Error('EVAL_VERSION must be one of "v1", "v2", or "v3".');
  }
  return value;
}
