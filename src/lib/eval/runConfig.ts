export const DEFAULT_EVAL_REPEATS = 3;
export const MAX_EVAL_REPEATS = 20;

export function parseEvalRepeats(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_EVAL_REPEATS;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`EVAL_REPEATS must be an integer from 1 to ${MAX_EVAL_REPEATS}.`);
  }
  const repeats = Number(raw);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > MAX_EVAL_REPEATS) {
    throw new Error(`EVAL_REPEATS must be an integer from 1 to ${MAX_EVAL_REPEATS}.`);
  }
  return repeats;
}
