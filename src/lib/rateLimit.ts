import "server-only";

import { createHash } from "node:crypto";

// Fixed-window limiter. It uses Upstash Redis when configured so counters are
// shared across serverless instances, and falls back to memory for local
// development or a temporary Redis outage.

type Bucket = { count: number; resetAt: number };
type Bucketset = Map<string, Bucket>;
const DEFAULT_BUCKETS: Bucketset = new Map();
const NAMED_BUCKETS: Map<string, Bucketset> = new Map();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  backend: "redis" | "memory";
};

type RateLimitOptions = { max?: number; windowMs?: number; namespace?: string };

function memoryRateLimit(
  key: string,
  opts: RateLimitOptions = {},
): RateLimitResult {
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
    return { allowed: true, remaining: max - 1, retryAfterSec: 0, backend: "memory" };
  }
  if (b.count >= max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000), backend: "memory" };
  }
  b.count += 1;
  return { allowed: true, remaining: max - b.count, retryAfterSec: 0, backend: "memory" };
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
    remaining: Math.max(0, max - count),
    retryAfterSec: count <= max ? 0 : Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000)),
    backend: "redis",
  };
}

export async function rateLimit(key: string, opts: RateLimitOptions = {}): Promise<RateLimitResult> {
  const config = redisConfig();
  if (config) {
    try {
      return await redisRateLimit(config, key, opts);
    } catch (error) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "distributed_rate_limit_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return memoryRateLimit(key, opts);
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || "anonymous";
  return ip;
}
