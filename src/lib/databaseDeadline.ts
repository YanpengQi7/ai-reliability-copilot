export const DATABASE_QUERY_TIMEOUT_MS = 10_000;

export function createDatabaseQuerySignal(timeoutMs = DATABASE_QUERY_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}
