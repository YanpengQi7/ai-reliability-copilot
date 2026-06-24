export const DATABASE_QUERY_TIMEOUT_MS = 10_000;

export type DatabaseDeadline = {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
};

export type DatabaseDeadlineFailure = "request_aborted" | "timed_out" | null;

export function createDatabaseDeadline(
  requestSignal?: AbortSignal,
  timeoutMs = DATABASE_QUERY_TIMEOUT_MS,
): DatabaseDeadline {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    timeoutSignal,
    signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
  };
}

export function createDatabaseQuerySignal(timeoutMs = DATABASE_QUERY_TIMEOUT_MS): AbortSignal {
  return createDatabaseDeadline(undefined, timeoutMs).signal;
}

export function classifyDatabaseDeadlineFailure(
  requestSignal: AbortSignal | undefined,
  deadline: DatabaseDeadline,
): DatabaseDeadlineFailure {
  if (requestSignal?.aborted) return "request_aborted";
  if (deadline.timeoutSignal.aborted) return "timed_out";
  return null;
}
