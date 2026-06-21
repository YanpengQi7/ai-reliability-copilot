import { afterEach, describe, expect, it, vi } from "vitest";
import { clientKey, createMemoryRateLimiter, createRateLimiter, rateLimit, withRateLimitHeaders } from "./rateLimit";

const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalTrustProxy = process.env.TRUST_PROXY_HEADERS;

afterEach(() => {
  restore("UPSTASH_REDIS_REST_URL", originalUrl);
  restore("UPSTASH_REDIS_REST_TOKEN", originalToken);
  restore("VERCEL", originalVercel);
  restore("VERCEL_ENV", originalVercelEnv);
  restore("TRUST_PROXY_HEADERS", originalTrustProxy);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("clientKey", () => {
  it("prefers Vercel's stable forwarded address", () => {
    process.env.VERCEL_ENV = "production";
    const req = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "198.51.100.10",
        "x-vercel-forwarded-for": "203.0.113.42",
      },
    });

    expect(clientKey(req)).toBe("203.0.113.42");
  });

  it("ignores self-hosted proxy headers unless explicitly trusted", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.TRUST_PROXY_HEADERS;
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.42" },
    });

    expect(clientKey(req)).toBe("anonymous");
    process.env.TRUST_PROXY_HEADERS = "true";
    expect(clientKey(req)).toBe("203.0.113.42");
  });

  it("rejects malformed forwarded addresses", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "attacker-controlled-value" },
    });

    expect(clientKey(req)).toBe("anonymous");
  });
});

describe("rateLimit", () => {
  it("uses the in-memory fallback when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const key = `memory-${crypto.randomUUID()}`;

    expect(await rateLimit(key, { max: 1 })).toMatchObject({ allowed: true, backend: "memory" });
    expect(await rateLimit(key, { max: 1 })).toMatchObject({ allowed: false, backend: "memory" });
  });

  it("uses one atomic Redis script and hashes the client identifier", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com/";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: [2, 45_000] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await rateLimit("203.0.113.42", { max: 3, namespace: "analyze" });

    expect(result).toEqual({ allowed: true, limit: 3, remaining: 1, retryAfterSec: 0, backend: "redis" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.example.com");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(String(init.body)).not.toContain("203.0.113.42");
    expect(JSON.parse(String(init.body))[0]).toBe("EVAL");
  });

  it("adds standard and legacy retry headers to rate-limited responses", () => {
    const response = withRateLimitHeaders(new Response("limited", { status: 429 }), {
      allowed: false,
      limit: 5,
      remaining: 0,
      retryAfterSec: 17,
      backend: "memory",
    });

    expect(response.headers.get("Retry-After")).toBe("17");
    expect(response.headers.get("RateLimit-Limit")).toBe("5");
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("RateLimit-Reset")).toBe("17");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(Number(response.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("falls back to memory if Redis is temporarily unavailable", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await rateLimit(`fallback-${crypto.randomUUID()}`, { max: 2 });

    expect(result).toMatchObject({ allowed: true, backend: "memory" });
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe("createMemoryRateLimiter", () => {
  it("bounds unique clients without evicting active buckets", () => {
    const limit = createMemoryRateLimiter(3);
    const opts = { max: 1, windowMs: 60_000 };

    expect(limit("client-a", opts, 0).allowed).toBe(true);
    expect(limit("client-b", opts, 0).allowed).toBe(true);
    expect(limit("client-c", opts, 0).allowed).toBe(true);
    expect(limit("client-d", opts, 0).allowed).toBe(false);
    expect(limit("client-a", opts, 0).allowed).toBe(false);
  });

  it("reclaims expired buckets before using overflow", () => {
    const limit = createMemoryRateLimiter(3);
    const opts = { max: 1, windowMs: 10 };

    limit("expired-a", opts, 0);
    limit("expired-b", opts, 0);
    expect(limit("fresh-a", opts, 10).allowed).toBe(true);
    expect(limit("fresh-b", opts, 10).allowed).toBe(true);
    expect(limit("fresh-a", opts, 10).allowed).toBe(false);
  });
});

describe("createRateLimiter", () => {
  it("opens a short circuit after Redis fails", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    let now = 1_000;
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const limit = createRateLimiter({ now: () => now, redisFailureBackoffMs: 10_000 });

    expect(await limit("client-a")).toMatchObject({ backend: "memory" });
    expect(await limit("client-b")).toMatchObject({ backend: "memory" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);

    now = 11_000;
    expect(await limit("client-c")).toMatchObject({ backend: "memory" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
