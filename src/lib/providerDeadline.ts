export const PROVIDER_TIMEOUT_MS = 120_000;

export type ProviderDeadline = {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
};

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
