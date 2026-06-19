import "server-only";

import { createHash } from "node:crypto";
import { safeErrorDetail } from "./observability";

// Fixed-window limiter. It uses Upstash Redis when configured so counters are
// shared across serverless instances, and falls back to memory for local
// development or a temporary Redis outage.

type Bucket = { count: number; resetAt: number };
type BucketKey = string | symbol;
type Bucketset = Map<BucketKey, Bucket>;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MAX_MEMORY_BUCKETS_PER_NAMESPACE = 10_000;
const REDIS_FAILURE_BACKOFF_MS = 10_000;
const OVERFLOW_BUCKET = Symbol("rate-limit-overflow");

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  backend: "redis" | "memory";
};

type RateLimitOptions = { max?: number; windowMs?: number; namespace?: string };

function removeExpiredBuckets(bucketset: Bucketset, now: number) {
  for (const [key, bucket] of bucketset) {
    if (bucket.resetAt <= now) bucketset.delete(key);
  }
}

export function createMemoryRateLimiter(maxBucketsPerNamespace = MAX_MEMORY_BUCKETS_PER_NAMESPACE) {
  if (maxBucketsPerNamespace < 2) throw new Error("Memory rate limiter capacity must be at least 2.");
  const defaultBuckets: Bucketset = new Map();
  const namedBuckets = new Map<string, Bucketset>();

  return function limit(
    key: string,
    opts: RateLimitOptions = {},
    now = Date.now(),
  ): RateLimitResult {
    const max = opts.max ?? MAX_PER_WINDOW;
    const windowMs = opts.windowMs ?? WINDOW_MS;
    let bucketset = defaultBuckets;
    if (opts.namespace) {
      bucketset = namedBuckets.get(opts.namespace) ?? new Map();
      namedBuckets.set(opts.namespace, bucketset);
    }

    let bucketKey: BucketKey = key;
    if (!bucketset.has(bucketKey) && bucketset.size >= maxBucketsPerNamespace - 1) {
      removeExpiredBuckets(bucketset, now);
      if (bucketset.size >= maxBucketsPerNamespace - 1) bucketKey = OVERFLOW_BUCKET;
    }

    const bucket = bucketset.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucketset.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true, limit: max, remaining: max - 1, retryAfterSec: 0, backend: "memory" };
    }
    if (bucket.count >= max) {
      return { allowed: false, limit: max, remaining: 0, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000), backend: "memory" };
    }
    bucket.count += 1;
    return { allowed: true, limit: max, remaining: max - bucket.count, retryAfterSec: 0, backend: "memory" };
  };
}

const FIXED_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`.trim();

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function distributedRateLimitConfigured(): boolean {
  return redisConfig() !== null;
}

function redisKey(key: string, namespace?: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `sre-copilot:rate-limit:${namespace ?? "default"}:${digest}`;
}

async function redisRateLimit(
  config: { url: string; token: string },
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const max = opts.max ?? MAX_PER_WINDOW;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["EVAL", FIXED_WINDOW_SCRIPT, 1, redisKey(key, opts.namespace), windowMs]),
    cache: "no-store",
    signal: AbortSignal.timeout(1_000),
  });
  if (!response.ok) throw new Error(`Redis returned HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  if (!Array.isArray(body.result) || body.result.length < 2) {
    throw new Error("Redis returned an invalid rate-limit response");
  }
  const count = Number(body.result[0]);
  const ttlMs = Number(body.result[1]);
  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
    throw new Error("Redis returned non-numeric rate-limit values");
  }
  return {
    allowed: count <= max,
    limit: max,
    remaining: Math.max(0, max - count),
    retryAfterSec: count <= max ? 0 : Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000)),
    backend: "redis",
  };
}

export function createRateLimiter(options: {
  now?: () => number;
  redisFailureBackoffMs?: number;
} = {}) {
  const now = options.now ?? Date.now;
  const redisFailureBackoffMs = options.redisFailureBackoffMs ?? REDIS_FAILURE_BACKOFF_MS;
  const memoryRateLimit = createMemoryRateLimiter();
  let redisUnavailableUntil = 0;

  return async function limit(key: string, opts: RateLimitOptions = {}): Promise<RateLimitResult> {
    const config = redisConfig();
    const currentTime = now();
    if (config && currentTime >= redisUnavailableUntil) {
      try {
        const result = await redisRateLimit(config, key, opts);
        redisUnavailableUntil = 0;
        return result;
      } catch (error) {
        redisUnavailableUntil = currentTime + redisFailureBackoffMs;
        console.warn(JSON.stringify({
          level: "warn",
          event: "distributed_rate_limit_failed",
          error: safeErrorDetail(error),
          retry_in_ms: redisFailureBackoffMs,
        }));
      }
    }
    return memoryRateLimit(key, opts, currentTime);
  };
}

export const rateLimit = createRateLimiter();

/** Attach machine-readable retry metadata to a 429 response. */
export function withRateLimitHeaders(response: Response, result: RateLimitResult): Response {
  const headers = new Headers(response.headers);
  const retryAfter = String(Math.max(1, result.retryAfterSec));
  headers.set("Retry-After", retryAfter);
  headers.set("RateLimit-Limit", String(result.limit));
  headers.set("RateLimit-Remaining", String(result.remaining));
  headers.set("RateLimit-Reset", retryAfter);
  // Retain the widely deployed legacy names for existing API clients.
  headers.set("X-RateLimit-Limit", String(result.limit));
  headers.set("X-RateLimit-Remaining", String(result.remaining));
  headers.set("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + Number(retryAfter)));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || "anonymous";
  return ip;
}
