// In-memory token bucket for demo rate limiting. Resets on cold start (acceptable for demo).
// For production, swap to Upstash Redis or Vercel KV.

type Bucket = { count: number; resetAt: number };
type Bucketset = Map<string, Bucket>;
const DEFAULT_BUCKETS: Bucketset = new Map();
const NAMED_BUCKETS: Map<string, Bucketset> = new Map();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

export function rateLimit(
  key: string,
  opts: { max?: number; windowMs?: number; namespace?: string } = {},
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const max = opts.max ?? MAX_PER_WINDOW;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  let bucketset = DEFAULT_BUCKETS;
  if (opts.namespace) {
    bucketset = NAMED_BUCKETS.get(opts.namespace) ?? new Map();
    NAMED_BUCKETS.set(opts.namespace, bucketset);
  }
  const now = Date.now();
  const b = bucketset.get(key);
  if (!b || b.resetAt < now) {
    bucketset.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSec: 0 };
  }
  if (b.count >= max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { allowed: true, remaining: max - b.count, retryAfterSec: 0 };
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || "anonymous";
  return ip;
}
