export const PROVIDER_TIMEOUT_MS = 120_000;

export type ProviderDeadline = {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
};

export type ProviderDeadlineFailure = "request_aborted" | "timed_out" | null;

export function createProviderDeadline(
  requestSignal?: AbortSignal,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): ProviderDeadline {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    timeoutSignal,
    signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
  };
}

export function classifyProviderDeadlineFailure(
  requestSignal: AbortSignal | undefined,
  deadline: ProviderDeadline,
): ProviderDeadlineFailure {
  if (requestSignal?.aborted) return "request_aborted";
  if (deadline.timeoutSignal.aborted) return "timed_out";
  return null;
}
